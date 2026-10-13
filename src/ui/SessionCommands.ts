import * as vscode from 'vscode';
import type { AgentRegistry } from '../agents/registry';
import { sessionKey, type SessionRecord } from '../model/types';
import { uniquifyTitle } from '../model/titles';
import type { Restorer } from '../restore/Restorer';
import type { SessionStore } from '../store/SessionStore';

export interface SessionCommandsOptions {
  store: SessionStore;
  registry: AgentRegistry;
  restorer: Restorer;
  resumeTemplateFor?: (agent: string) => string | undefined;
  refresh: () => void;
}

export type SessionAction =
  | 'resume'
  | 'rename'
  | 'togglePin'
  | 'archive'
  | 'copyResumeCommand'
  | 'copySessionId'
  | 'openTranscript'
  | 'showTerminal'
  | 'deleteRecord';

function recordFromArg(arg: unknown, store: SessionStore): SessionRecord | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const candidate = arg as { record?: SessionRecord; agent?: string; sessionId?: string } &
    Partial<SessionRecord>;
  if (candidate.record) return candidate.record;
  if (candidate.agent && candidate.sessionId) {
    return store.get(candidate.agent, candidate.sessionId) ?? (candidate as SessionRecord);
  }
  return undefined;
}

/** Rename, pin, archive, copy, transcript, terminal and delete for one session. */
export class SessionCommands {
  private readonly store: SessionStore;
  private readonly registry: AgentRegistry;
  private readonly restorer: Restorer;
  private readonly resumeTemplateFor: ((agent: string) => string | undefined) | undefined;
  private readonly refresh: () => void;

  constructor(options: SessionCommandsOptions) {
    this.store = options.store;
    this.registry = options.registry;
    this.restorer = options.restorer;
    this.resumeTemplateFor = options.resumeTemplateFor;
    this.refresh = options.refresh;
  }

  register(context: vscode.ExtensionContext): void {
    const handlers: [SessionAction, (arg?: unknown) => Promise<void>][] = [
      ['rename', (arg) => this.rename(arg)],
      ['togglePin', (arg) => this.togglePin(arg)],
      ['archive', (arg) => this.archive(arg)],
      ['copyResumeCommand', (arg) => this.copyResumeCommand(arg)],
      ['copySessionId', (arg) => this.copySessionId(arg)],
      ['openTranscript', (arg) => this.openTranscript(arg)],
      ['showTerminal', (arg) => this.showTerminal(arg)],
      ['deleteRecord', (arg) => this.deleteRecord(arg)],
    ];
    for (const [action, handler] of handlers) {
      context.subscriptions.push(
        vscode.commands.registerCommand(`agentSessions.${action}`, handler),
      );
    }
  }

  /** Entry point for the history webview. */
  async perform(action: SessionAction, agent: string, sessionId: string): Promise<void> {
    const record = this.store.get(agent, sessionId);
    if (!record) return;
    if (action === 'resume') {
      await this.restorer.resume(record);
      return;
    }
    await this.run(action, record);
  }

  private async run(action: SessionAction, record: SessionRecord): Promise<void> {
    switch (action) {
      case 'rename':
        await this.renameRecord(record);
        break;
      case 'togglePin':
        await this.store.update(record.agent, record.sessionId, { pinned: !record.pinned });
        break;
      case 'archive':
        await this.store.update(record.agent, record.sessionId, { status: 'archived' });
        break;
      case 'copyResumeCommand':
        await this.copy(record);
        break;
      case 'copySessionId':
        await this.copyId(record);
        break;
      case 'openTranscript':
        await this.openTranscriptRecord(record);
        break;
      case 'showTerminal':
        this.showTerminalRecord(record);
        break;
      case 'deleteRecord':
        await this.deleteRecord(record);
        break;
      default:
        break;
    }
    this.refresh();
  }

  private async rename(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.renameRecord(record);
    this.refresh();
  }

  private async renameRecord(record: SessionRecord): Promise<void> {
    const title = await vscode.window.showInputBox({
      prompt: 'Session title',
      value: record.title,
    });
    if (title === undefined || title.trim().length === 0) return;
    const unique = uniquifyTitle(title.trim(), this.store.all(), sessionKey(record.agent, record.sessionId));
    await this.store.update(record.agent, record.sessionId, {
      title: unique,
      titleSource: 'user',
    });
  }

  private async togglePin(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.store.update(record.agent, record.sessionId, { pinned: !record.pinned });
    this.refresh();
  }

  private async archive(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.store.update(record.agent, record.sessionId, { status: 'archived' });
    this.refresh();
  }

  private async copyResumeCommand(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.copy(record);
  }

  private async copy(record: SessionRecord): Promise<void> {
    const adapter = this.registry.get(record.agent);
    if (!adapter) return;
    const command = adapter.buildResumeCommand(record, this.resumeTemplateFor?.(record.agent));
    await vscode.env.clipboard.writeText(command);
    void vscode.window.showInformationMessage(`Agent Sessions: copied \`${command}\`.`);
  }

  private async copySessionId(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.copyId(record);
  }

  private async copyId(record: SessionRecord): Promise<void> {
    await vscode.env.clipboard.writeText(record.sessionId);
    void vscode.window.showInformationMessage(
      `Agent Sessions: copied session ID \`${record.sessionId}\`.`,
    );
  }

  private async openTranscript(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    await this.openTranscriptRecord(record);
  }

  private async openTranscriptRecord(record: SessionRecord): Promise<void> {
    const adapter = this.registry.get(record.agent);
    const transcript = await adapter?.transcriptPathFor(record);
    if (!transcript) {
      void vscode.window.showWarningMessage(
        `Agent Sessions: no transcript file found for "${record.title}".`,
      );
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(transcript));
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async showTerminal(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    this.showTerminalRecord(record);
  }

  private showTerminalRecord(record: SessionRecord): void {
    const terminal = vscode.window.terminals.find((candidate) =>
      candidate.name.includes(record.title),
    );
    if (terminal) terminal.show();
    else void vscode.window.showInformationMessage(`Agent Sessions: no open terminal for "${record.title}".`);
  }

  private async deleteRecord(arg?: unknown): Promise<void> {
    const record = recordFromArg(arg, this.store);
    if (!record) return;
    const choice = await vscode.window.showWarningMessage(
      `Delete the record for "${record.title}"? The agent's own transcript is not touched.`,
      { modal: true },
      'Delete',
    );
    if (choice !== 'Delete') return;
    await this.store.delete(record.agent, record.sessionId);
    this.refresh();
  }
}
