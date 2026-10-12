import * as vscode from 'vscode';

/** Wait for a terminal's shell integration, or undefined after the timeout. */
export function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs = 3000,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(undefined);
    }, timeoutMs);
    const subscription = vscode.window.onDidChangeTerminalShellIntegration((event) => {
      if (event.terminal === terminal) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(event.shellIntegration);
      }
    });
  });
}
