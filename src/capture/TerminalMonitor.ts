import * as vscode from 'vscode';
import { normalizeCommandLine } from '../agents/commandLine';
import type { AgentRegistry } from '../agents/registry';
import type { PendingLaunch } from '../model/types';
import type { StoreLogger } from '../store/SessionStore';
import type { Correlator } from './Correlator';

export interface TerminalMonitorOptions {
  registry: AgentRegistry;
  correlator: Correlator;
  logger?: StoreLogger;
}

/**
 * Thin wrapper over VS Code's shell-integration events. It recognises agent
 * commands and hands launches and exits to the correlator.
 */
export class TerminalMonitor {
  private readonly registry: AgentRegistry;
  private readonly correlator: Correlator;
  private readonly logger: StoreLogger | undefined;
  private readonly terminalKeys = new WeakMap<vscode.Terminal, string>();
  private counter = 0;

  constructor(options: TerminalMonitorOptions) {
    this.registry = options.registry;
    this.correlator = options.correlator;
    this.logger = options.logger;
  }

  start(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.window.onDidStartTerminalShellExecution((event) => {
        void this.onStart(event);
      }),
      vscode.window.onDidEndTerminalShellExecution((event) => {
        void this.correlator.onTerminalEnded(this.keyFor(event.terminal));
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        void this.correlator.onTerminalClosed(this.keyFor(terminal));
      }),
    );
  }

  private keyFor(terminal: vscode.Terminal): string {
    let key = this.terminalKeys.get(terminal);
    if (!key) {
      this.counter += 1;
      key = `t${this.counter}`;
      this.terminalKeys.set(terminal, key);
    }
    return key;
  }

  private async onStart(event: vscode.TerminalShellExecutionStartEvent): Promise<void> {
    const commandLine = event.execution.commandLine.value;
    const resolved = this.registry.resolveCommand(normalizeCommandLine(commandLine));
    if (!resolved || !resolved.match.interactive) return;

    const terminal = event.terminal;
    const launch: PendingLaunch = {
      terminalKey: this.keyFor(terminal),
      agent: resolved.adapter.id,
      cwd: event.execution.cwd?.fsPath ?? '',
      commandLine,
      startedAt: new Date().toISOString(),
      isResume: resolved.match.isResume,
      via: 'shell-integration',
      terminalName: terminal.name,
    };
    if (resolved.match.explicitSessionId) launch.explicitSessionId = resolved.match.explicitSessionId;
    if (resolved.match.name) launch.name = resolved.match.name;
    const shellPid = await terminal.processId;
    if (shellPid !== undefined) launch.shellPid = shellPid;
    this.correlator.registerTerminal(launch.terminalKey, shellPid);

    this.logger?.info(`launch ${resolved.adapter.id} in ${launch.cwd}`);
    await this.correlator.onLaunch(launch);
  }
}
