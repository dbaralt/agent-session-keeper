import * as vscode from 'vscode';
import type { SessionRecord } from '../model/types';

export interface HistoryHost {
  records(): SessionRecord[];
  workspaceFolders(): { path: string; name: string }[];
  resumeMany(sessionIds: string[]): Promise<void> | void;
  perform(action: string, agent: string, sessionId: string): Promise<void> | void;
  importExisting(): Promise<void> | void;
}

interface WebviewMessage {
  type?: string;
  sessionIds?: string[];
  action?: string;
  agent?: string;
  sessionId?: string;
}

/** Singleton webview that renders the searchable session history. */
export class HistoryPanel {
  static current: HistoryPanel | undefined;

  static async createOrShow(extensionUri: vscode.Uri, host: HistoryHost): Promise<HistoryPanel> {
    if (HistoryPanel.current) {
      HistoryPanel.current.host = host;
      HistoryPanel.current.panel.reveal();
      HistoryPanel.current.refresh();
      return HistoryPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentSessions.history',
      'Agent Session History',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    const instance = new HistoryPanel(panel, extensionUri, host);
    await instance.setHtml();
    HistoryPanel.current = instance;
    return instance;
  }

  static async revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    host: HistoryHost,
  ): Promise<void> {
    const instance = new HistoryPanel(panel, extensionUri, host);
    await instance.setHtml();
    HistoryPanel.current = instance;
  }

  private readonly extensionUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private host: HistoryHost;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, host: HistoryHost) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.host = host;
    this.panel.onDidDispose(() => {
      if (HistoryPanel.current === this) HistoryPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.onMessage(message);
    });
  }

  reveal(): void {
    this.panel.reveal();
  }

  refresh(): void {
    void this.post();
  }

  private async post(): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'sessions',
      sessions: this.host.records(),
      workspaces: this.host.workspaceFolders(),
    });
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.post();
        break;
      case 'resumeSelected':
        await this.host.resumeMany(message.sessionIds ?? []);
        break;
      case 'import':
        await this.host.importExisting();
        await this.post();
        break;
      case 'action':
        if (message.action && message.agent && message.sessionId) {
          await this.host.perform(message.action, message.agent, message.sessionId);
        }
        await this.post();
        break;
      default:
        break;
    }
  }

  private async setHtml(): Promise<void> {
    const webview = this.panel.webview;
    const htmlUri = vscode.Uri.joinPath(this.extensionUri, 'media', 'history.html');
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'history.css'),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'history.js'),
    );
    const template = Buffer.from(await vscode.workspace.fs.readFile(htmlUri)).toString('utf8');
    webview.html = template
      .replaceAll('{{csp}}', webview.cspSource)
      .replaceAll('{{style}}', cssUri.toString())
      .replaceAll('{{script}}', jsUri.toString());
  }
}
