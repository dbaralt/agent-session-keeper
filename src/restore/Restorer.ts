import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import type { AgentRegistry } from '../agents/registry';
import type { SessionRecord } from '../model/types';
import type { SessionStore, StoreLogger } from '../store/SessionStore';

export type ResumeOutcome = 'resumed' | 'missing' | 'cancelled' | 'no-adapter';

export interface RestorerOptions {
  store: SessionStore;
  registry: AgentRegistry;
  logger?: StoreLogger;
  windowSessionId: string;
  terminalLocation: 'panel' | 'editor';
  resumeTemplateFor?: (agent: string) => string | undefined;
}

async function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) return terminal.shellIntegration;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(undefined);
    }, timeoutMs);
    const subscription = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === terminal) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(event.shellIntegration);
      }
    });
  });
}

/** Reopens one or many recorded sessions in new terminals. */
export class Restorer {
  private readonly store: SessionStore;
  private readonly registry: AgentRegistry;
  private readonly logger: StoreLogger | undefined;
  private readonly windowSessionId: string;
  private readonly terminalLocation: 'panel' | 'editor';
  private readonly resumeTemplateFor: ((agent: string) => string | undefined) | undefined;

  constructor(options: RestorerOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.logger = options.logger;
    this.windowSessionId = options.windowSessionId;
    this.terminalLocation = options.terminalLocation;
    this.resumeTemplateFor = options.resumeTemplateFor;
  }

  async resume(record: SessionRecord): Promise<ResumeOutcome> {
    const adapter = this.registry.get(record.agent);
    if (!adapter) {
      void vscode.window.showWarningMessage(
        `Agent Sessions: no adapter for agent "${record.agent}".`,
      );
      return 'no-adapter';
    }

    const transcript = await adapter.transcriptPathFor(record);
    if (!transcript) {
      await this.store.update(record.agent, record.sessionId, { status: 'missing' });
      void vscode.window.showWarningMessage(
        `Agent Sessions: the transcript for "${record.title}" is missing, so it cannot be resumed.`,
      );
      return 'missing';
    }

    let cwd = record.cwd;
    if (!cwd || !existsSync(cwd)) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: 'Resume here',
        title: `Choose a folder to resume "${record.title}"`,
      });
      if (!picked?.[0]) return 'cancelled';
      cwd = picked[0].fsPath;
    }

    const template = this.resumeTemplateFor?.(record.agent);
    const command = adapter.buildResumeCommand({ ...record, cwd }, template);
    const terminal = vscode.window.createTerminal({
      name: `${adapter.displayName}: ${record.title}`,
      cwd,
      env: { AGENT_SESSIONS_TERMINAL_ID: `${record.agent}/${record.sessionId}` },
      location:
        this.terminalLocation === 'editor'
          ? vscode.TerminalLocation.Editor
          : vscode.TerminalLocation.Panel,
    });
    terminal.show();

    const integration = await waitForShellIntegration(terminal, 3000);
    if (integration) integration.executeCommand(command);
    else terminal.sendText(command, true);

    const now = new Date().toISOString();
    await this.store.update(record.agent, record.sessionId, {
      status: 'running',
      cwd,
      transcriptPath: transcript,
      lastResumedAt: now,
      launch: { ...record.launch, via: 'shell-integration', windowSessionId: this.windowSessionId },
    });
    this.logger?.info(`resumed ${record.agent}/${record.sessionId} in ${cwd}`);
    return 'resumed';
  }

  /** Resume several sessions, spaced out so shells do not all start at once. */
  async resumeMany(records: readonly SessionRecord[], delayMs = 500): Promise<ResumeOutcome[]> {
    const outcomes: ResumeOutcome[] = [];
    for (const record of records) {
      outcomes.push(await this.resume(record));
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return outcomes;
  }
}
