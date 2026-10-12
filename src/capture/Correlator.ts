import path from 'node:path';
import type { AgentAdapter } from '../agents/AgentAdapter';
import type { AgentRegistry } from '../agents/registry';
import {
  parseSessionKey,
  sessionKey,
  SESSION_SCHEMA_VERSION,
  type BindingConfidence,
  type PendingLaunch,
  type SessionFileInfo,
  type SessionRecord,
  type TitleSource,
} from '../model/types';
import type { SessionStore, StoreLogger } from '../store/SessionStore';
import type { HookEvent, SessionFileEvent } from './events';

export interface WorkspaceInfo {
  folder?: string;
  name?: string;
}

export interface CorrelatorOptions {
  store: SessionStore;
  registry: AgentRegistry;
  machine: string;
  windowSessionId: string;
  titleFromFirstPrompt?: boolean;
  now?: () => number;
  logger?: StoreLogger;
  workspaceFolderFor?: (cwd: string) => WorkspaceInfo | undefined;
}

interface BindParams {
  agent: string;
  sessionId: string;
  cwd: string;
  launch: PendingLaunch;
  confidence: BindingConfidence;
  terminalKey?: string;
  info?: SessionFileInfo;
  filePath?: string;
  parentSessionId?: string;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 10_000;
const MATCH_WINDOW_MS = 2_000;

function parseMs(iso: string | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

/**
 * Binds launches, session files and terminal events to records. It owns no I/O
 * except through the store, so it can be tested with a fake clock and synthetic
 * events.
 */
export class Correlator {
  private readonly store: SessionStore;
  private readonly registry: AgentRegistry;
  private readonly machine: string;
  private readonly windowSessionId: string;
  private readonly titleFromFirstPrompt: boolean;
  private readonly now: () => number;
  private readonly logger: StoreLogger | undefined;
  private readonly workspaceFolderFor: ((cwd: string) => WorkspaceInfo | undefined) | undefined;

  private readonly pending: PendingLaunch[] = [];
  private readonly terminalSessions = new Map<string, string>();
  private readonly terminalPids = new Map<string, number>();
  private readonly lastActivityWrite = new Map<string, number>();

  constructor(options: CorrelatorOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.machine = options.machine;
    this.windowSessionId = options.windowSessionId;
    this.titleFromFirstPrompt = options.titleFromFirstPrompt ?? true;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.workspaceFolderFor = options.workspaceFolderFor;
  }

  pendingLaunches(): PendingLaunch[] {
    return [...this.pending];
  }

  terminalSessionKey(terminalKey: string): string | undefined {
    return this.terminalSessions.get(terminalKey);
  }

  /** Remember a terminal's shell pid so hook events can be matched by ancestry. */
  registerTerminal(terminalKey: string, shellPid?: number): void {
    if (shellPid !== undefined) this.terminalPids.set(terminalKey, shellPid);
  }

  /** An exact-capture hook event arrived on the spool. */
  async onHookEvent(event: HookEvent): Promise<SessionRecord | undefined> {
    const adapter = this.registry.get(event.agent);
    const sessionId = event.session_id;
    if (!adapter || !sessionId) return undefined;

    const cwd = event.cwd ?? '';
    const filePath = event.transcript_path ?? '';
    const info: SessionFileInfo = { sessionId };
    if (cwd) info.cwd = cwd;

    const pending = this.takePendingForHook(event.agent, adapter, info, filePath);
    const terminalKey = pending?.terminalKey ?? this.terminalKeyForHook(event);

    let parentSessionId: string | undefined;
    if (terminalKey && (event.source === 'clear' || event.source === 'fork')) {
      const parsed = parseSessionKey(this.terminalSessions.get(terminalKey) ?? '');
      if (parsed && parsed.sessionId !== sessionId) parentSessionId = parsed.sessionId;
    }

    const launch: PendingLaunch = {
      terminalKey: terminalKey ?? '',
      agent: event.agent,
      cwd,
      commandLine: `(hook ${event.event})`,
      startedAt: event.ts ?? new Date(this.now()).toISOString(),
      isResume: false,
      via: 'hook',
    };

    const params: BindParams = {
      agent: event.agent,
      sessionId,
      cwd,
      launch,
      confidence: 'exact',
      info,
    };
    if (terminalKey) params.terminalKey = terminalKey;
    if (filePath) params.filePath = filePath;
    if (parentSessionId) params.parentSessionId = parentSessionId;
    return this.bind(params);
  }

  /** A command line was recognized as starting an agent. */
  async onLaunch(launch: PendingLaunch): Promise<SessionRecord | undefined> {
    this.prunePending();
    if (launch.explicitSessionId) {
      return this.bind({
        agent: launch.agent,
        sessionId: launch.explicitSessionId,
        cwd: launch.cwd,
        launch,
        confidence: 'exact',
        terminalKey: launch.terminalKey,
      });
    }
    this.pending.push(launch);
    return undefined;
  }

  /** A session file appeared or changed. */
  async onSessionFile(event: SessionFileEvent): Promise<SessionRecord | undefined> {
    const adapter = this.registry.get(event.agent);
    if (!adapter) return undefined;

    const match = this.takePendingFor(event);
    if (match) {
      return this.bind({
        agent: event.agent,
        sessionId: event.info.sessionId,
        cwd: match.launch.cwd,
        launch: match.launch,
        confidence: match.within ? 'high' : 'low',
        terminalKey: match.launch.terminalKey,
        info: event.info,
        filePath: event.filePath,
      });
    }

    const existing = this.store.get(event.agent, event.info.sessionId);
    if (existing) return this.touchExisting(event, existing);

    // No launch and no record: a mid-session switch, or a session started where
    // shell integration is silent (tmux, plain ssh).
    const switchedFrom = event.isNew ? this.findRunningSessionInCwd(event) : undefined;
    if (switchedFrom) {
      const parent = parseSessionKey(switchedFrom);
      const parentRecord = parent ? this.store.get(parent.agent, parent.sessionId) : undefined;
      const terminalKey = this.terminalForSession(switchedFrom);
      if (parent && parentRecord && terminalKey) {
        return this.bind({
          agent: event.agent,
          sessionId: event.info.sessionId,
          cwd: parentRecord.cwd,
          launch: {
            terminalKey,
            agent: event.agent,
            cwd: parentRecord.cwd,
            commandLine: `(${parent.agent} session switch)`,
            startedAt: new Date(event.createdAtMs).toISOString(),
            isResume: true,
            via: 'shell-integration',
          },
          confidence: 'high',
          terminalKey,
          info: event.info,
          filePath: event.filePath,
          parentSessionId: parent.sessionId,
        });
      }
    }

    const cwd = event.info.cwd ?? '';
    return this.bind({
      agent: event.agent,
      sessionId: event.info.sessionId,
      cwd,
      launch: {
        terminalKey: '',
        agent: event.agent,
        cwd,
        commandLine: '',
        startedAt: new Date(event.createdAtMs).toISOString(),
        isResume: false,
        via: 'import',
      },
      confidence: 'low',
      info: event.info,
      filePath: event.filePath,
    });
  }

  /** The agent process in a terminal ended but the terminal is still open. */
  async onTerminalEnded(terminalKey: string): Promise<void> {
    const key = this.terminalSessions.get(terminalKey);
    if (!key) return;
    const parsed = parseSessionKey(key);
    if (!parsed) return;
    const record = this.store.get(parsed.agent, parsed.sessionId);
    if (record?.status === 'running') {
      await this.store.update(parsed.agent, parsed.sessionId, { status: 'exited' });
    }
  }

  /** The terminal was closed. */
  async onTerminalClosed(terminalKey: string): Promise<void> {
    const key = this.terminalSessions.get(terminalKey);
    this.terminalSessions.delete(terminalKey);
    if (!key) return;
    const parsed = parseSessionKey(key);
    if (!parsed) return;
    const record = this.store.get(parsed.agent, parsed.sessionId);
    if (record && (record.status === 'running' || record.status === 'exited')) {
      await this.store.update(parsed.agent, parsed.sessionId, { status: 'closed' });
    }
  }

  // --- internals -----------------------------------------------------------

  private async bind(params: BindParams): Promise<SessionRecord> {
    const { agent, sessionId, cwd, launch, confidence, terminalKey, info, filePath } = params;
    const existing = this.store.get(agent, sessionId);
    const nowIso = new Date(this.now()).toISOString();
    const workspace = this.workspaceFolderFor?.(cwd);
    const adapter = this.registry.get(agent);
    const folderName = cwd ? path.basename(cwd) : 'unknown';
    const { title, titleSource } = this.resolveTitle(
      existing,
      launch,
      info,
      adapter?.displayName ?? agent,
      folderName,
      nowIso,
    );

    const record: SessionRecord = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      agent,
      sessionId,
      title,
      titleSource,
      cwd,
      createdAt: existing?.createdAt ?? info?.startedAt ?? launch.startedAt ?? nowIso,
      lastActiveAt: nowIso,
      status: 'running',
      bindingConfidence: confidence,
      launch: {
        commandLine: launch.commandLine,
        via: launch.via ?? 'shell-integration',
        windowSessionId: this.windowSessionId,
      },
      machine: this.machine,
      updatedAt: nowIso,
    };

    if (workspace?.folder) record.workspaceFolder = workspace.folder;
    if (workspace?.name) record.workspaceName = workspace.name;
    if (info?.gitBranch) record.gitBranch = info.gitBranch;
    const transcript = filePath ?? existing?.transcriptPath;
    if (transcript) record.transcriptPath = transcript;
    if (params.parentSessionId) record.parentSessionId = params.parentSessionId;
    if (existing?.pinned !== undefined) record.pinned = existing.pinned;
    if (existing?.notes) record.notes = existing.notes;
    if (launch.shellPid !== undefined) record.launch.shellPid = launch.shellPid;
    if (launch.terminalName) record.launch.terminalName = launch.terminalName;

    const saved = await this.store.upsert(record);
    if (terminalKey) this.terminalSessions.set(terminalKey, sessionKey(agent, sessionId));
    this.lastActivityWrite.set(sessionKey(agent, sessionId), this.now());
    this.logger?.info(
      `bound ${agent}/${sessionId} (${confidence})${params.parentSessionId ? ` from ${params.parentSessionId}` : ''}`,
    );
    return saved;
  }

  private async touchExisting(
    event: SessionFileEvent,
    existing: SessionRecord,
  ): Promise<SessionRecord> {
    const key = sessionKey(existing.agent, existing.sessionId);
    const lastWrite = this.lastActivityWrite.get(key) ?? 0;
    if (existing.status === 'running' && this.now() - lastWrite < ACTIVITY_THROTTLE_MS) {
      return existing;
    }
    const lastActiveAt = new Date(
      Math.max(event.modifiedAtMs, parseMs(existing.lastActiveAt)),
    ).toISOString();
    const patch: Partial<SessionRecord> = {
      lastActiveAt,
      updatedAt: new Date(this.now()).toISOString(),
    };
    if (existing.status !== 'running') patch.status = 'running';
    if (!existing.transcriptPath) patch.transcriptPath = event.filePath;
    const updated = await this.store.update(existing.agent, existing.sessionId, patch);
    this.lastActivityWrite.set(key, this.now());
    return updated ?? existing;
  }

  private resolveTitle(
    existing: SessionRecord | undefined,
    launch: PendingLaunch,
    info: SessionFileInfo | undefined,
    displayName: string,
    folderName: string,
    nowIso: string,
  ): { title: string; titleSource: TitleSource } {
    if (existing?.titleSource === 'user' && existing.title) {
      return { title: existing.title, titleSource: 'user' };
    }
    if (launch.name) return { title: launch.name, titleSource: 'agent' };
    if (info?.name) return { title: info.name, titleSource: 'agent' };
    if (this.titleFromFirstPrompt && info?.firstPrompt) {
      return { title: info.firstPrompt, titleSource: 'firstPrompt' };
    }
    const time = new Date(nowIso).toISOString().slice(11, 16);
    return { title: `${displayName} · ${folderName} · ${time}`, titleSource: 'fallback' };
  }

  private takePendingFor(event: SessionFileEvent): { launch: PendingLaunch; within: boolean } | undefined {
    const adapter = this.registry.get(event.agent);
    if (!adapter) return undefined;
    const candidates = this.pending
      .map((launch, index) => ({ launch, index }))
      .filter(
        ({ launch }) =>
          launch.agent === event.agent &&
          adapter.fileBelongsToCwd(event.filePath, event.info, launch.cwd),
      )
      .sort((a, b) => parseMs(a.launch.startedAt) - parseMs(b.launch.startedAt));
    if (candidates.length === 0) return undefined;

    const withinCandidate = candidates.find(({ launch }) => {
      const delta = event.createdAtMs - parseMs(launch.startedAt);
      return delta >= -MATCH_WINDOW_MS && delta <= MATCH_WINDOW_MS;
    });
    const chosen = withinCandidate ?? candidates[0]!;
    this.pending.splice(chosen.index, 1);
    const delta = event.createdAtMs - parseMs(chosen.launch.startedAt);
    return { launch: chosen.launch, within: delta >= -MATCH_WINDOW_MS && delta <= MATCH_WINDOW_MS };
  }

  private findRunningSessionInCwd(event: SessionFileEvent): string | undefined {
    const adapter = this.registry.get(event.agent);
    if (!adapter) return undefined;
    for (const [terminalKey, key] of this.terminalSessions) {
      const parsed = parseSessionKey(key);
      if (!parsed || parsed.agent !== event.agent) continue;
      const record = this.store.get(parsed.agent, parsed.sessionId);
      if (!record || record.status !== 'running') continue;
      if (adapter.fileBelongsToCwd(event.filePath, event.info, record.cwd)) {
        return terminalKey ? key : undefined;
      }
    }
    return undefined;
  }

  private terminalForSession(key: string): string | undefined {
    for (const [terminalKey, sessionKeyValue] of this.terminalSessions) {
      if (sessionKeyValue === key) return terminalKey;
    }
    return undefined;
  }

  private takePendingForHook(
    agent: string,
    adapter: AgentAdapter,
    info: SessionFileInfo,
    filePath: string,
  ): PendingLaunch | undefined {
    const index = this.pending.findIndex(
      (launch) => launch.agent === agent && adapter.fileBelongsToCwd(filePath, info, launch.cwd),
    );
    if (index < 0) return undefined;
    return this.pending.splice(index, 1)[0];
  }

  private terminalKeyForHook(event: HookEvent): string | undefined {
    if (event.terminalId) {
      for (const [terminalKey, value] of this.terminalSessions) {
        if (value === event.terminalId) return terminalKey;
      }
    }
    if (event.ancestorPids) {
      for (const [terminalKey, pid] of this.terminalPids) {
        if (event.ancestorPids.includes(pid)) return terminalKey;
      }
    }
    return undefined;
  }

  private prunePending(): void {
    const cutoff = this.now() - PENDING_TTL_MS;
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (parseMs(this.pending[i]!.startedAt) < cutoff) this.pending.splice(i, 1);
    }
  }
}
