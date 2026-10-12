import { EventEmitter } from 'node:events';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  AGENT_IDS,
  isAgentId,
  isSessionRecord,
  mergeSessionRecords,
  normalizeRecord,
  sessionKey,
  type AgentId,
  type SessionRecord,
} from '../model/types';
import { writeJsonAtomic } from './atomicWrite';
import { withFileLock } from './lock';

export interface StoreLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SessionStoreOptions {
  rootDir: string;
  logger?: StoreLogger;
}

export type SessionChange =
  | { type: 'upsert'; key: string; record: SessionRecord }
  | { type: 'delete'; key: string };

type ChangeListener = (change: SessionChange) => void;

const REFRESH_DEBOUNCE_MS = 100;

function sessionFileName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * The single source of truth for session records: one JSON file per
 * `agent/sessionId`, safe for several VS Code windows to write at once.
 *
 * - every write is atomic (tmp + rename);
 * - {@link update} applies a field patch on top of the freshest on-disk copy
 *   under an inter-process lock, so concurrent writers keep each other's fields;
 * - {@link upsert} merges a full record field by field, newer `updatedAt` wins;
 * - a watcher refreshes the in-memory map when another window changes a file.
 */
export class SessionStore {
  readonly rootDir: string;
  readonly sessionsDir: string;

  private readonly records = new Map<string, SessionRecord>();
  private readonly emitter = new EventEmitter();
  private readonly logger: StoreLogger | undefined;
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private watchers: FSWatcher[] = [];
  private disposed = false;

  constructor(options: SessionStoreOptions) {
    this.rootDir = options.rootDir;
    this.sessionsDir = path.join(options.rootDir, 'sessions');
    this.logger = options.logger;
  }

  /** Subscribe to record changes from this window or any other. */
  onDidChange(listener: ChangeListener): () => void {
    this.emitter.on('change', listener);
    return () => {
      this.emitter.off('change', listener);
    };
  }

  all(): SessionRecord[] {
    return [...this.records.values()];
  }

  get(agent: AgentId, sessionId: string): SessionRecord | undefined {
    return this.records.get(sessionKey(agent, sessionId));
  }

  filePathFor(agent: AgentId, sessionId: string): string {
    return path.join(this.sessionsDir, agent, `${sessionFileName(sessionId)}.json`);
  }

  /** Create the sessions folder, load what is there and start watching it. */
  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await this.loadFromDisk();
    this.startWatcher();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    this.emitter.removeAllListeners();
  }

  /** Re-read every file from disk, replacing the in-memory map. */
  async loadFromDisk(): Promise<SessionRecord[]> {
    const loaded: SessionRecord[] = [];
    for (const entry of await safeReaddir(this.sessionsDir)) {
      if (!isAgentId(entry)) continue;
      const dir = path.join(this.sessionsDir, entry);
      for (const file of await safeReaddir(dir)) {
        if (!file.endsWith('.json')) continue;
        const record = await this.readRecord(path.join(dir, file));
        if (!record) continue;
        this.records.set(sessionKey(record.agent, record.sessionId), record);
        loaded.push(record);
      }
    }
    return loaded;
  }

  async reload(): Promise<SessionRecord[]> {
    this.records.clear();
    return this.loadFromDisk();
  }

  /** Write a full record. Fields absent from `record` keep their old value. */
  async upsert(record: SessionRecord): Promise<SessionRecord> {
    const normalized = normalizeRecord(record);
    const key = sessionKey(normalized.agent, normalized.sessionId);
    const filePath = this.filePathFor(normalized.agent, normalized.sessionId);
    const merged = await this.mutate(filePath, key, (existing) =>
      mergeSessionRecords(existing, normalized),
    );
    if (!merged) throw new Error(`Failed to write record ${key}`);
    this.commit(merged);
    return merged;
  }

  /**
   * Apply a field-level patch to the freshest version of a record. Concurrent
   * updates to different fields of one record do not overwrite each other.
   */
  async update(
    agent: AgentId,
    sessionId: string,
    patch: Partial<SessionRecord>,
  ): Promise<SessionRecord | undefined> {
    const key = sessionKey(agent, sessionId);
    const filePath = this.filePathFor(agent, sessionId);
    const next = await this.mutate(filePath, key, (existing) => {
      if (!existing) return undefined;
      return normalizeRecord({
        ...existing,
        ...patch,
        agent: existing.agent,
        sessionId: existing.sessionId,
        updatedAt: patch.updatedAt ?? new Date().toISOString(),
      });
    });
    if (!next) return undefined;
    this.commit(next);
    return next;
  }

  async delete(agent: AgentId, sessionId: string): Promise<void> {
    const key = sessionKey(agent, sessionId);
    const filePath = this.filePathFor(agent, sessionId);
    await withFileLock(`${filePath}.lock`, async () => {
      await rm(filePath, { force: true });
    });
    if (this.records.delete(key)) {
      this.emitter.emit('change', { type: 'delete', key } satisfies SessionChange);
    }
  }

  private commit(record: SessionRecord): void {
    const key = sessionKey(record.agent, record.sessionId);
    this.records.set(key, record);
    this.emitter.emit('change', { type: 'upsert', key, record } satisfies SessionChange);
  }

  private async mutate(
    filePath: string,
    key: string,
    mutator: (existing: SessionRecord | undefined) => SessionRecord | undefined,
  ): Promise<SessionRecord | undefined> {
    return withFileLock(`${filePath}.lock`, async () => {
      const onDisk = await this.readRecord(filePath);
      const existing = onDisk ?? this.records.get(key);
      const next = mutator(existing);
      if (!next) return undefined;
      await writeJsonAtomic(filePath, next);
      return next;
    });
  }

  private async readRecord(filePath: string): Promise<SessionRecord | undefined> {
    const loaded = await this.loadRecord(filePath);
    return typeof loaded === 'object' ? loaded : undefined;
  }

  private async loadRecord(
    filePath: string,
  ): Promise<SessionRecord | 'missing' | 'invalid'> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      this.logger?.warn(`could not read session record ${filePath}: ${String(error)}`);
      return 'invalid';
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isSessionRecord(parsed)) {
        this.logger?.warn(`ignoring malformed session record ${filePath}`);
        return 'invalid';
      }
      return normalizeRecord(parsed);
    } catch {
      this.logger?.warn(`ignoring unparseable session record ${filePath}`);
      return 'invalid';
    }
  }

  private startWatcher(): void {
    try {
      const watcher = watch(this.sessionsDir, { recursive: true }, (_event, filename) => {
        const name = typeof filename === 'string' ? filename : undefined;
        if (!name || !name.endsWith('.json')) return;
        this.scheduleRefresh(path.join(this.sessionsDir, name));
      });
      watcher.on('error', (error) => {
        this.logger?.warn(`session store watcher error: ${String(error)}`);
      });
      this.watchers.push(watcher);
    } catch (error) {
      this.logger?.warn(`recursive watch unavailable (${String(error)}); watching per folder`);
      this.startFallbackWatcher();
    }
  }

  /** Non-recursive fallback for platforms without recursive `fs.watch`. */
  private startFallbackWatcher(): void {
    const dirs = [
      this.sessionsDir,
      ...AGENT_IDS.map((agent) => path.join(this.sessionsDir, agent)),
    ];
    for (const dir of dirs) {
      try {
        const watcher = watch(dir, (_event, filename) => {
          const name = typeof filename === 'string' ? filename : undefined;
          if (!name || !name.endsWith('.json')) return;
          this.scheduleRefresh(path.join(dir, name));
        });
        this.watchers.push(watcher);
      } catch {
        // Folder does not exist yet; it will be picked up on the next activation.
      }
    }
  }

  private scheduleRefresh(filePath: string): void {
    if (this.disposed) return;
    const existing = this.refreshTimers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.refreshTimers.delete(filePath);
      void this.refreshFile(filePath);
    }, REFRESH_DEBOUNCE_MS);
    this.refreshTimers.set(filePath, timer);
  }

  private async refreshFile(filePath: string): Promise<void> {
    if (this.disposed) return;
    const loaded = await this.loadRecord(filePath);
    if (loaded === 'invalid') return;

    const key = this.findKeyByPath(filePath);
    if (loaded === 'missing') {
      if (key && this.records.delete(key)) {
        this.emitter.emit('change', { type: 'delete', key } satisfies SessionChange);
      }
      return;
    }

    const loadedKey = sessionKey(loaded.agent, loaded.sessionId);
    const previous = this.records.get(loadedKey);
    if (previous && previous.updatedAt === loaded.updatedAt && key === loadedKey) return;
    this.records.set(loadedKey, loaded);
    this.emitter.emit('change', {
      type: 'upsert',
      key: loadedKey,
      record: loaded,
    } satisfies SessionChange);
  }

  private findKeyByPath(filePath: string): string | undefined {
    for (const [key, record] of this.records) {
      if (this.filePathFor(record.agent, record.sessionId) === filePath) return key;
    }
    return undefined;
  }
}
