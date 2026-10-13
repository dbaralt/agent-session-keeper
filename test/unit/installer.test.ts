import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HooksInstaller, addClaudeHooks, removeClaudeHooks } from '../../src/hooks/installer';

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'ask-installer-'));
  tempDirs.push(base);
  const storageDir = path.join(base, 'storage');
  const claudeConfigDir = path.join(base, 'claude');
  const piAgentDir = path.join(base, 'pi');
  await mkdir(claudeConfigDir, { recursive: true });
  const installer = new HooksInstaller({
    storageDir,
    claudeConfigDir,
    piAgentDir,
    hookSourcePath: path.join(repoRoot, 'resources/hook.js'),
    piExtensionSourcePath: path.join(repoRoot, 'resources/pi-extension.ts'),
    env: {},
  });
  return { base, storageDir, claudeConfigDir, piAgentDir, installer };
}

describe('claude hook merge helpers', () => {
  it('adds and removes only its own entries', () => {
    const settings: Record<string, unknown> = {
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool' }] }],
      },
      model: 'opus',
    };
    const command = '/home/me/.agent-sessions/bin/hook.js';
    const spool = '/home/me/.agent-sessions/spool';
    addClaudeHooks(settings, command, spool);
    addClaudeHooks(settings, command, spool);
    const sessionStart = (settings.hooks as Record<string, unknown[]>).SessionStart as unknown[];
    expect(sessionStart).toHaveLength(2);
    removeClaudeHooks(settings, command);
    expect(settings).toEqual({
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool' }] }],
      },
      model: 'opus',
    });
  });

  it('removes the hooks key entirely when nothing is left', () => {
    const settings: Record<string, unknown> = {};
    addClaudeHooks(settings, 'hook.js', '/spool');
    removeClaudeHooks(settings, 'hook.js');
    expect(settings).toEqual({});
  });
});

describe('HooksInstaller', () => {
  it('installs and uninstalls so settings.json is byte-identical', async () => {
    const { claudeConfigDir, piAgentDir, installer, storageDir } = await setup();
    const settingsPath = path.join(claudeConfigDir, 'settings.json');
    const original = `{\n    "model": "opus",\n  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "keep-me" } ] } ] }\n}\n`;
    await writeFile(settingsPath, original, 'utf8');

    await installer.install();
    expect(existsSync(path.join(storageDir, 'bin', 'hook.js'))).toBe(true);
    expect(existsSync(path.join(piAgentDir, 'extensions', 'agent-session-keeper.ts'))).toBe(true);

    const installed = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };
    expect(installed.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(installed)).toContain('hook.js');
    expect(JSON.stringify(installed)).toContain('keep-me');

    await installer.uninstall();

    expect(await readFile(settingsPath, 'utf8')).toBe(original);
    expect(existsSync(path.join(piAgentDir, 'extensions', 'agent-session-keeper.ts'))).toBe(false);
  });

  it('deletes settings.json it created when there was none', async () => {
    const { claudeConfigDir, installer } = await setup();
    const settingsPath = path.join(claudeConfigDir, 'settings.json');
    expect(existsSync(settingsPath)).toBe(false);
    await installer.install();
    expect(existsSync(settingsPath)).toBe(true);
    await installer.uninstall();
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('is idempotent and reports status', async () => {
    const { installer } = await setup();
    await installer.install();
    await installer.install();
    const status = await installer.status();
    expect(status).toEqual({ claude: true, pi: true });
    await installer.uninstall();
    expect(await installer.status()).toEqual({ claude: false, pi: false });
  });

  it('templates the spool path into the installed pi extension', async () => {
    const { installer, piAgentDir, storageDir } = await setup();
    await installer.install();
    const installed = await readFile(
      path.join(piAgentDir, 'extensions', 'agent-session-keeper.ts'),
      'utf8',
    );
    expect(installed).toContain(JSON.stringify(path.join(storageDir, 'spool')));
    expect(installed).not.toContain('__AGENT_SESSIONS_SPOOL_DIR__');
  });
});
