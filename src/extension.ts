import * as vscode from 'vscode';
import { hostname } from 'node:os';
import { createDefaultRegistry, type AgentConfig, type AgentRegistry } from './agents/registry';
import { Correlator } from './capture/Correlator';
import { SessionDirWatcher } from './capture/SessionDirWatcher';
import { TerminalMonitor } from './capture/TerminalMonitor';
import { initLog, log } from './log';
import type { SessionRecord } from './model/types';
import { Restorer } from './restore/Restorer';
import { StartupRestore } from './restore/StartupRestore';
import { StatusBar } from './restore/StatusBar';
import { SessionStore } from './store/SessionStore';
import { resolveStorageDir } from './store/storageDir';
import { activationMessage } from './util/activation';
import { SessionTreeProvider } from './ui/SessionTreeProvider';

/** Commands contributed in package.json, registered here as stubs until M6/M7. */
const STUB_COMMANDS = [
  'agentSessions.openHistory',
  'agentSessions.refresh',
  'agentSessions.newSession',
  'agentSessions.newClaude',
  'agentSessions.newPi',
  'agentSessions.rename',
  'agentSessions.togglePin',
  'agentSessions.archive',
  'agentSessions.installHooks',
  'agentSessions.uninstallHooks',
  'agentSessions.copyResumeCommand',
  'agentSessions.openTranscript',
  'agentSessions.showTerminal',
  'agentSessions.deleteRecord',
  'agentSessions.importExisting',
] as const;

function settings() {
  return vscode.workspace.getConfiguration('agentSessions');
}

function agentConfig(id: string): AgentConfig {
  const config: AgentConfig = {};
  const enabled = settings().get<boolean>(`agents.${id}.enabled`);
  if (enabled !== undefined) config.enabled = enabled;
  const patterns = settings().get<string[]>(`agents.${id}.commandPatterns`);
  if (patterns && patterns.length > 0) config.patterns = patterns;
  const root = settings().get<string>(`agents.${id}.sessionRoot`);
  if (root) config.sessionRoot = root;
  return config;
}

function buildRegistry(): AgentRegistry {
  return createDefaultRegistry({
    agents: {
      claude: agentConfig('claude'),
      pi: agentConfig('pi'),
    },
  });
}

function workspaceFolderFor(cwd: string): { folder?: string; name?: string } | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
  if (!folder) return undefined;
  return { folder: folder.uri.fsPath, name: folder.name };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Agent Sessions', { log: true });
  context.subscriptions.push(output);
  initLog(output);

  log().info(activationMessage(context.extension.packageJSON.version as string));

  const storageSetting = settings().get<string>('storageDir');
  const storageDir = resolveStorageDir(storageSetting ? { settingValue: storageSetting } : {});
  log().info(`storage: ${storageDir}`);

  const store = new SessionStore({ rootDir: storageDir, logger: log() });
  context.subscriptions.push({ dispose: () => void store.dispose() });
  try {
    await store.init();
    log().info(`loaded ${store.all().length} session record(s)`);
  } catch (error) {
    log().error(`could not initialise the session store: ${String(error)}`);
  }

  const registry = buildRegistry();
  log().info(`agents: ${registry.ids().join(', ')}`);

  const correlator = new Correlator({
    store,
    registry,
    machine: hostname(),
    windowSessionId: vscode.env.sessionId,
    titleFromFirstPrompt: settings().get<boolean>('titleFromFirstPrompt') ?? true,
    logger: log(),
    workspaceFolderFor,
  });

  new TerminalMonitor({ registry, correlator, logger: log() }).start(context);

  const watcher = new SessionDirWatcher({
    registry,
    logger: log(),
    onEvent: (event) => {
      void correlator.onSessionFile(event);
    },
  });
  context.subscriptions.push({ dispose: () => void watcher.dispose() });
  watcher.start().catch((error) => log().error(`session watcher failed: ${String(error)}`));

  const treeProvider = new SessionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('agentSessions.tree', treeProvider),
  );

  const restorer = new Restorer({
    store,
    registry,
    logger: log(),
    windowSessionId: vscode.env.sessionId,
    terminalLocation: settings().get<'panel' | 'editor'>('terminalLocation') ?? 'panel',
    resumeTemplateFor: (agent) => {
      const value = settings().get<string>(`agents.${agent}.resumeCommand`);
      return value && value.trim() ? value : undefined;
    },
  });

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);
  const refreshStatusBar = (): void => {
    statusBar.update(store.all().filter((record) => record.status === 'interrupted').length);
  };
  context.subscriptions.push({ dispose: store.onDidChange(refreshStatusBar) });

  const startup = new StartupRestore({
    store,
    restorer,
    statusBar,
    logger: log(),
    setting: settings().get<'prompt' | 'always' | 'never'>('restoreOnStartup') ?? 'prompt',
  });
  void startup.run();

  const resolveRecord = (arg: unknown): SessionRecord | undefined => {
    if (!arg || typeof arg !== 'object') return undefined;
    const candidate = arg as { record?: SessionRecord; agent?: string; sessionId?: string } & Partial<SessionRecord>;
    if (candidate.record) return candidate.record;
    if (candidate.agent && candidate.sessionId) {
      return store.get(candidate.agent, candidate.sessionId) ?? (candidate as SessionRecord);
    }
    return undefined;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('agentSessions.resume', async (arg?: unknown) => {
      const record = resolveRecord(arg);
      if (!record) {
        void vscode.window.showWarningMessage('Agent Sessions: no session selected.');
        return;
      }
      await restorer.resume(record);
    }),
    vscode.commands.registerCommand('agentSessions.restoreInterrupted', async () => {
      const interrupted = store.all().filter((record) => record.status === 'interrupted');
      if (interrupted.length === 0) {
        void vscode.window.showInformationMessage('Agent Sessions: nothing to restore.');
        return;
      }
      await startup.chooseAndResume(interrupted);
    }),
  );

  for (const command of STUB_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        log().info(`command "${command}" is not implemented yet`);
        void vscode.window.showInformationMessage(
          'Agent Session Keeper: this command is not implemented yet.',
        );
      }),
    );
  }

  log().info('activated');
}

export function deactivate(): void {
  // Disposables registered on the context clean up the store and watcher.
}
