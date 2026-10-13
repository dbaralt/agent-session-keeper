import * as vscode from 'vscode';
import type { AgentRegistry } from '../agents/registry';
import type { SessionRecord } from '../model/types';
import type { SessionStore } from '../store/SessionStore';

export interface GroupElement {
  kind: 'group';
  id: string;
  label: string;
  icon: string;
  records: SessionRecord[];
}

export type TreeElement = GroupElement | { kind: 'record'; record: SessionRecord };

const HIDDEN_STATUSES = new Set(['archived']);

/** Human-friendly relative time for a tree item description. */
export function relativeTime(iso: string, now = Date.now()): string {
  const delta = now - Date.parse(iso);
  if (Number.isNaN(delta)) return '';
  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function byPinnedThenActive(a: SessionRecord, b: SessionRecord): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  return Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt);
}

/** Sidebar tree: Interrupted, Running, This workspace, All workspaces. */
export class SessionTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly store: SessionStore;
  private readonly registry: AgentRegistry;

  constructor(store: SessionStore, registry: AgentRegistry) {
    this.store = store;
    this.registry = registry;
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element.kind === 'group' ? this.groupItem(element) : this.recordItem(element.record);
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) return this.groups();
    if (element.kind === 'group') {
      return element.records.map((record) => ({ kind: 'record', record }));
    }
    return [];
  }

  private groups(): GroupElement[] {
    const records = this.store.all().filter((record) => !HIDDEN_STATUSES.has(record.status));
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

    const interrupted = records.filter((record) => record.status === 'interrupted');
    const running = records.filter((record) => record.status === 'running' || record.status === 'pending');
    const rest = records.filter(
      (record) => !interrupted.includes(record) && !running.includes(record),
    );
    const workspace = rest.filter(
      (record) => record.workspaceFolder && folders.includes(record.workspaceFolder),
    );
    const others = rest.filter((record) => !workspace.includes(record));

    const groups: GroupElement[] = [
      { kind: 'group', id: 'interrupted', label: 'Interrupted', icon: 'warning', records: interrupted },
      { kind: 'group', id: 'running', label: 'Running', icon: 'play', records: running },
      { kind: 'group', id: 'workspace', label: 'This workspace', icon: 'folder', records: workspace },
      { kind: 'group', id: 'all', label: 'All workspaces', icon: 'globe', records: others },
    ];
    for (const group of groups) group.records.sort(byPinnedThenActive);
    return groups.filter((group) => group.records.length > 0);
  }

  private groupItem(element: GroupElement): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = `group:${element.id}`;
    item.contextValue = 'group';
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.description = String(element.records.length);
    return item;
  }

  private recordItem(record: SessionRecord): vscode.TreeItem {
    const adapter = this.registry.get(record.agent);
    const item = new vscode.TreeItem(record.title, vscode.TreeItemCollapsibleState.None);
    item.id = `${record.agent}/${record.sessionId}`;
    item.contextValue = 'session';
    item.description = `${adapter?.displayName ?? record.agent} · ${relativeTime(record.lastActiveAt)}`;
    item.iconPath = new vscode.ThemeIcon(record.pinned ? 'pinned' : adapter?.icon ?? 'circle-outline');
    item.tooltip = this.tooltip(record);
    item.command = {
      command: 'agentSessions.resume',
      title: 'Resume',
      arguments: [record],
    };
    return item;
  }

  private tooltip(record: SessionRecord): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown('**');
    md.appendText(record.title);
    md.appendMarkdown('**\n\n');
    const rows: [string, string][] = [
      ['Agent', record.agent],
      ['Status', record.status],
      ['Folder', record.cwd],
    ];
    if (record.gitBranch) rows.push(['Branch', record.gitBranch]);
    rows.push(['Started', record.createdAt], ['Last active', record.lastActiveAt]);
    if (record.sessionId) rows.push(['Session', record.sessionId]);
    for (const [label, value] of rows) {
      md.appendMarkdown(`${label}: `);
      md.appendText(value);
      md.appendMarkdown('\n');
    }
    return md;
  }
}
