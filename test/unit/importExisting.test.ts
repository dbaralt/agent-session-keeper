import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeAdapter } from '../../src/agents/claude';
import { AgentRegistry } from '../../src/agents/registry';
import { importExisting } from '../../src/import/importExisting';
import { SessionStore } from '../../src/store/SessionStore';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('importExisting', () => {
  it('backfills records from session files once', async () => {
    const storeDir = await mkdtemp(path.join(os.tmpdir(), 'ask-import-'));
    tempDirs.push(storeDir);
    const store = new SessionStore({ rootDir: storeDir });
    await store.init();

    const fixtures = path.join(process.cwd(), 'test/fixtures/claude');
    const registry = new AgentRegistry().register(createClaudeAdapter({ sessionRoot: fixtures, env: {} }));

    const first = await importExisting({
      store,
      registry,
      machine: 'test',
      windowSessionId: 'window-1',
    });
    expect(first).toBe(1);

    const record = store.get('claude', 'c0ffee00-0000-4000-8000-000000000001');
    expect(record).toMatchObject({
      title: 'refactor the auth middleware please',
      titleSource: 'firstPrompt',
      cwd: '/Users/me/code/api',
      gitBranch: 'feat/auth',
      status: 'closed',
      launch: { via: 'import' },
    });
    expect(record?.transcriptPath).toContain('c0ffee00-0000-4000-8000-000000000001.jsonl');

    const second = await importExisting({
      store,
      registry,
      machine: 'test',
      windowSessionId: 'window-1',
    });
    expect(second).toBe(0);
    await store.dispose();
  });

  it('ignores Claude subagent transcripts', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'ask-import-sub-'));
    tempDirs.push(base);
    const root = path.join(base, 'claude');
    const project = path.join(root, 'projects', '-p-api');
    await mkdir(path.join(project, 'main', 'subagents'), { recursive: true });
    const userLine = (id: string) =>
      `${JSON.stringify({
        type: 'user',
        sessionId: id,
        cwd: '/p/api',
        isMeta: false,
        timestamp: '2026-01-02T03:00:00.000Z',
        message: { role: 'user', content: 'hello' },
      })}\n`;
    await writeFile(path.join(project, 'main.jsonl'), userLine('main'));
    await writeFile(path.join(project, 'main', 'subagents', 'agent-x.jsonl'), userLine('agent-x'));

    const storeDir = path.join(base, 'records');
    const store = new SessionStore({ rootDir: storeDir });
    await store.init();
    const registry = new AgentRegistry().register(createClaudeAdapter({ sessionRoot: root, env: {} }));

    const count = await importExisting({
      store,
      registry,
      machine: 'test',
      windowSessionId: 'window-1',
    });
    expect(count).toBe(1);
    expect(store.get('claude', 'main')).toBeDefined();
    expect(store.get('claude', 'agent-x')).toBeUndefined();
    await store.dispose();
  });
});
