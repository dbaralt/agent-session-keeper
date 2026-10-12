import * as vscode from 'vscode';
import { initLog, log } from './log';
import { activationMessage } from './util/activation';
import { SessionTreeProvider } from './ui/SessionTreeProvider';

/** Commands contributed in package.json, registered here as milestone 1 stubs. */
const STUB_COMMANDS = [
  'agentSessions.openHistory',
  'agentSessions.refresh',
  'agentSessions.newSession',
  'agentSessions.resume',
  'agentSessions.restoreInterrupted',
  'agentSessions.newClaude',
  'agentSessions.newCodex',
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

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Agent Sessions', { log: true });
  context.subscriptions.push(output);
  initLog(output);

  log().info(activationMessage(context.extension.packageJSON.version as string));
  log().info(`storage: not wired yet (milestone 2)`);

  const treeProvider = new SessionTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('agentSessions.tree', treeProvider),
  );

  for (const command of STUB_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        log().info(`command "${command}" is a milestone 1 stub`);
        void vscode.window.showInformationMessage(
          'Agent Session Keeper: this command is not implemented yet.',
        );
      }),
    );
  }

  log().info('activated');
}

export function deactivate(): void {
  // Nothing to clean up yet; files and terminals are owned by later milestones.
}
