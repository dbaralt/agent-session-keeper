import * as vscode from 'vscode';

/**
 * Placeholder tree provider for milestone 1. Later milestones replace the
 * single info item with the real Interrupted / Running / workspace groups.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const item = new vscode.TreeItem('No sessions yet', vscode.TreeItemCollapsibleState.None);
    item.description = 'milestone 1 scaffold';
    item.tooltip = 'Session capture arrives in milestone 4.';
    item.iconPath = new vscode.ThemeIcon('info');
    return [item];
  }

  refresh(): void {
    this.changeEmitter.fire();
  }
}
