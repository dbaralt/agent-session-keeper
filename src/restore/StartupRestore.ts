import * as vscode from 'vscode';
import type { SessionRecord } from '../model/types';
import type { SessionStore, StoreLogger } from '../store/SessionStore';
import { detectInterrupted, type LiveTerminal } from './interrupted';
import type { Restorer } from './Restorer';
import type { StatusBar } from './StatusBar';

export interface StartupRestoreOptions {
  store: SessionStore;
  restorer: Restorer;
  statusBar: StatusBar;
  setting: 'prompt' | 'always' | 'never';
  logger?: StoreLogger;
}

/** Marks sessions interrupted on activation and offers to reopen them. */
export class StartupRestore {
  private readonly store: SessionStore;
  private readonly restorer: Restorer;
  private readonly statusBar: StatusBar;
  private readonly setting: 'prompt' | 'always' | 'never';
  private readonly logger: StoreLogger | undefined;

  constructor(options: StartupRestoreOptions) {
    this.store = options.store;
    this.restorer = options.restorer;
    this.statusBar = options.statusBar;
    this.setting = options.setting;
    this.logger = options.logger;
  }

  async run(): Promise<void> {
    const records = this.store.all();
    const liveTerminals = await this.liveTerminals();
    const { interrupted, stillRunning } = detectInterrupted(
      records,
      vscode.env.sessionId,
      liveTerminals,
    );

    for (const record of stillRunning) {
      await this.store.update(record.agent, record.sessionId, {
        launch: { ...record.launch, windowSessionId: vscode.env.sessionId },
      });
    }
    for (const record of interrupted) {
      await this.store.update(record.agent, record.sessionId, { status: 'interrupted' });
    }
    this.statusBar.update(interrupted.length);
    this.logger?.info(
      `startup: ${stillRunning.length} running, ${interrupted.length} interrupted${
        liveTerminals.length ? `, ${liveTerminals.length} live terminal(s)` : ''
      }`,
    );

    if (interrupted.length === 0 || this.setting === 'never') return;
    const relevant = this.relevantToWorkspace(interrupted);
    if (relevant.length === 0) return;

    if (this.setting === 'always') {
      await this.restorer.resumeMany(relevant);
      return;
    }

    const plural = interrupted.length === 1 ? 'session was' : 'sessions were';
    const choice = await vscode.window.showInformationMessage(
      `${interrupted.length} agent ${plural} interrupted when VS Code closed.`,
      'Restore all',
      'Choose\u2026',
      'Dismiss',
    );
    if (choice === 'Restore all') {
      await this.restorer.resumeMany(relevant);
    } else if (choice === 'Choose\u2026') {
      await this.chooseAndResume(relevant);
    }
  }

  async chooseAndResume(records: readonly SessionRecord[]): Promise<void> {
    const items = records.map((record) => ({
      label: record.title,
      description: `${record.agent} \u00b7 ${record.workspaceName ?? record.cwd}`,
      picked: true,
      record,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'Sessions to restore',
    });
    if (picked) await this.restorer.resumeMany(picked.map((item) => item.record));
  }

  private relevantToWorkspace(records: readonly SessionRecord[]): SessionRecord[] {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    if (folders.length === 0) return [...records];
    return records.filter(
      (record) => !record.workspaceFolder || folders.includes(record.workspaceFolder),
    );
  }

  private async liveTerminals(): Promise<LiveTerminal[]> {
    return Promise.all(
      vscode.window.terminals.map(async (terminal) => {
        const live: LiveTerminal = { key: terminal.name, name: terminal.name };
        const shellPid = await terminal.processId;
        if (shellPid !== undefined) live.shellPid = shellPid;
        return live;
      }),
    );
  }
}
