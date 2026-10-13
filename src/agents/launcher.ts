import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import type { AgentRegistry } from '../agents/registry';
import { SESSION_SCHEMA_VERSION, type SessionRecord } from '../model/types';
import { fallbackTitle, uniquifyTitle } from '../model/titles';
import type { SessionStore, StoreLogger } from '../store/SessionStore';
import { waitForShellIntegration } from '../restore/shellIntegration';

export interface LauncherOptions {
  store: SessionStore;
  registry: AgentRegistry;
  windowSessionId: string;
  machine: string;
  terminalLocation: 'panel' | 'editor';
  logger?: StoreLogger;
}

/** Starts a session from the extension, with a preset id where the agent allows it. */
export class Launcher {
  private readonly store: SessionStore;
  private readonly registry: AgentRegistry;
  private readonly windowSessionId: string;
  private readonly machine: string;
  private readonly terminalLocation: 'panel' | 'editor';
  private readonly logger: StoreLogger | undefined;

  constructor(options: LauncherOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.windowSessionId = options.windowSessionId;
    this.machine = options.machine;
    this.terminalLocation = options.terminalLocation;
    this.logger = options.logger;
  }

  async launch(agentId: string, title?: string): Promise<SessionRecord | undefined> {
    const adapter = this.registry.get(agentId);
    if (!adapter) {
      void vscode.window.showWarningMessage(`Agent Sessions: unknown agent "${agentId}".`);
      return undefined;
    }

    const sessionId = adapter.supportsPresetId ? randomUUID() : undefined;
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
    const now = new Date().toISOString();
    const requested = title?.trim();
    const sessionTitle = uniquifyTitle(
      requested ? requested : fallbackTitle(adapter.displayName, cwd),
      this.store.all(),
    );
    const command = adapter.buildNewCommand(
      sessionId
        ? requested
          ? { sessionId, name: sessionTitle }
          : { sessionId }
        : requested
          ? { name: sessionTitle }
          : {},
    );

    let record: SessionRecord | undefined;
    if (sessionId) {
      record = await this.store.upsert({
        schemaVersion: SESSION_SCHEMA_VERSION,
        agent: agentId,
        sessionId,
        title: sessionTitle,
        titleSource: requested ? 'user' : 'fallback',
        cwd,
        createdAt: now,
        lastActiveAt: now,
        status: 'pending',
        bindingConfidence: 'exact',
        launch: { commandLine: command, via: 'launcher', windowSessionId: this.windowSessionId },
        machine: this.machine,
        updatedAt: now,
      });
    }

    const terminal = vscode.window.createTerminal({
      name: requested ? `${adapter.displayName}: ${sessionTitle}` : adapter.displayName,
      cwd,
      env: sessionId ? { AGENT_SESSIONS_TERMINAL_ID: `${agentId}/${sessionId}` } : {},
      location:
        this.terminalLocation === 'editor'
          ? vscode.TerminalLocation.Editor
          : vscode.TerminalLocation.Panel,
    });
    terminal.show();
    const integration = await waitForShellIntegration(terminal, 3000);
    if (integration) integration.executeCommand(command);
    else terminal.sendText(command, true);
    this.logger?.info(`launched ${agentId}${sessionId ? ` as ${sessionId}` : ''}`);
    return record;
  }

  async newSession(): Promise<void> {
    const items = this.registry.all().map((adapter) => ({
      label: adapter.displayName,
      id: adapter.id,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: 'New agent session' });
    if (!picked) return;
    const title = await vscode.window.showInputBox({
      prompt: 'Session title (optional)',
      placeHolder: 'Refactor auth middleware',
    });
    if (title === undefined) return;
    await this.launch(picked.id, title.trim() || undefined);
  }
}
