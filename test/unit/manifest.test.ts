import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  main: string;
  engines: { vscode: string; node: string };
  activationEvents: string[];
  extensionKind: string[];
  contributes: {
    viewsContainers: { activitybar: { id: string }[] };
    views: Record<string, { id: string }[]>;
    commands: { command: string }[];
    configuration: { properties: Record<string, unknown> };
  };
  scripts: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as Manifest;

describe('package.json manifest', () => {
  it('points main at the bundled output', () => {
    expect(manifest.main).toBe('./dist/extension.js');
  });

  it('requires an engine that has onDidStartTerminalShellExecution', () => {
    const [major = 0, minor = 0] = manifest.engines.vscode
      .replace(/[^\d.]/g, '')
      .split('.')
      .map(Number);
    expect(major > 1 || (major === 1 && minor >= 93)).toBe(true);
  });

  it('activates on startup, the tree view and the history webview', () => {
    expect(manifest.activationEvents).toEqual(
      expect.arrayContaining([
        'onStartupFinished',
        'onView:agentSessions.tree',
        'onWebviewPanel:agentSessions.history',
      ]),
    );
  });

  it('runs beside the terminals and agent files', () => {
    expect(manifest.extensionKind).toEqual(['workspace']);
  });

  it('contributes the sessions view container and tree view', () => {
    expect(manifest.contributes.viewsContainers.activitybar[0]?.id).toBe('agentSessions');
    expect(manifest.contributes.views.agentSessions?.[0]?.id).toBe('agentSessions.tree');
  });

  it('contributes the spec command set', () => {
    const ids = manifest.contributes.commands.map((c) => c.command);
    for (const required of [
      'agentSessions.openHistory',
      'agentSessions.resume',
      'agentSessions.restoreInterrupted',
      'agentSessions.newClaude',
      'agentSessions.newPi',
      'agentSessions.rename',
      'agentSessions.togglePin',
      'agentSessions.archive',
      'agentSessions.installHooks',
      'agentSessions.uninstallHooks',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('contributes the spec settings', () => {
    const props = Object.keys(manifest.contributes.configuration.properties);
    expect(props).toEqual(
      expect.arrayContaining([
        'agentSessions.storageDir',
        'agentSessions.restoreOnStartup',
        'agentSessions.agents.pi.commandPatterns',
        'agentSessions.agents.pi.resumeCommand',
        'agentSessions.agents.pi.sessionRoot',
        'agentSessions.titleFromFirstPrompt',
        'agentSessions.terminalLocation',
      ]),
    );
  });

  it('provides the required npm scripts', () => {
    for (const script of [
      'build',
      'watch',
      'test',
      'test:integration',
      'sandbox',
      'package',
    ]) {
      expect(manifest.scripts[script], `missing script: ${script}`).toBeTruthy();
    }
  });
});
