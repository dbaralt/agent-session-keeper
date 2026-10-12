import type * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/** Store the extension's output channel once, during activation. */
export function initLog(output: vscode.LogOutputChannel): void {
  channel = output;
}

/** The "Agent Sessions" output channel. Throws if used before activation. */
export function log(): vscode.LogOutputChannel {
  if (!channel) {
    throw new Error('Agent Sessions log used before initLog()');
  }
  return channel;
}
