import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeAdapter } from '../../src/agents/claude';
import { AgentRegistry } from '../../src/agents/registry';
import { Correlator } from '../../src/capture/Correlator';
import type { HookEvent } from '../../src/capture/events';
import { HooksInstaller } from '../../src/hooks/installer';
import { SessionStore } from '../../src/store/SessionStore';

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface InstalledHook {
  command?: string;
  args?: string[];
}

async function installedHooks(claudeConfigDir: string): Promise<InstalledHook[]> {
  const settings = JSON.parse(
    await readFile(path.join(claudeConfigDir, 'settings.json'), 'utf8'),
  ) as { hooks: Record<string, { hooks: InstalledHook[] }[]> };
  const groups = settings.hooks.SessionStart ?? [];
  return groups.flatMap((group) => group.hooks);
}

describe('R2-1: Claude hooks are installed in exec form with an explicit spool dir', () => {
  it('runs each installed hook with agent=claude and lands in <storageDir>/spool', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'ask-r2-hook-'));
    tempDirs.push(base);
    const storageDir = path.join(base, 'storage');
    const claudeConfigDir = path.join(base, 'claude');
    const hookSource = path.join(repoRoot, 'resources', 'hook.js');

    const installer = new HooksInstaller({
      storageDir,
      claudeConfigDir,
      piAgentDir: path.join(base, 'pi'),
      hookSourcePath: hookSource,
      piExtensionSourcePath: path.join(repoRoot, 'resources', 'pi-extension.ts'),
      env: {},
    });
    await installer.install();

    const hookJsPath = path.join(storageDir, 'bin', 'hook.js');
    const spoolDir = path.join(storageDir, 'spool');
    const hooks = await installedHooks(claudeConfigDir);
    expect(hooks.length).toBeGreaterThan(0);

    for (const hook of hooks) {
      // Exec form: no shell string, explicit node + args.
      expect(hook.command).toBe('node');
      expect(hook.args).toContain(hookJsPath);
      expect(hook.args).toContain('claude');
      expect(hook.args).toContain('--spool');
      expect(hook.args).toContain(spoolDir);
    }

    // Run one hook exactly as Claude does, with no env var to fall back on.
    const env = { ...process.env };
    delete env.AGENT_SESSIONS_STORAGE_DIR;
    const run = spawnSync('node', hooks[0]!.args!, {
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: 'abc-123',
        cwd: '/p/api',
        transcript_path: '/tmp/abc-123.jsonl',
      }),
      encoding: 'utf8',
      env,
    });
    expect(run.status).toBe(0);

    const date = new Date().toISOString().slice(0, 10);
    const spoolFile = path.join(spoolDir, `events-${date}.jsonl`);
    const lines = (await readFile(spoolFile, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HookEvent);
    const event = lines.find((line) => line.session_id === 'abc-123');
    expect(event).toMatchObject({ agent: 'claude', event: 'SessionStart' });

    // Feed the spool line to the correlator; a record must appear.
    const storeDir = path.join(base, 'records');
    const store = new SessionStore({ rootDir: storeDir });
    await store.init();
    const registry = new AgentRegistry().register(
      createClaudeAdapter({ sessionRoot: path.join(base, 'claude-home'), env: {} }),
    );
    const correlator = new Correlator({
      store,
      registry,
      machine: 'test',
      windowSessionId: 'window-1',
    });
    await correlator.onHookEvent(event!);
    expect(store.get('claude', 'abc-123')).toMatchObject({ agent: 'claude', sessionId: 'abc-123' });
    await store.dispose();
  });
});
