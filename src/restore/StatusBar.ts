import * as vscode from 'vscode';

/** Shows `$(history) N interrupted` only when there is something to restore. */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'agentSessions.restoreInterrupted';
    this.item.name = 'Agent Sessions';
  }

  update(interruptedCount: number): void {
    if (interruptedCount > 0) {
      this.item.text = `$(history) ${interruptedCount} interrupted`;
      this.item.tooltip = 'Restore interrupted agent sessions';
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
