import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createClaudeAdapter } from '../../src/agents/claude';
import { AgentRegistry } from '../../src/agents/registry';
import type { SessionFileEvent } from '../../src/capture/events';
import { SessionDirWatcher } from '../../src/capture/SessionDirWatcher';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for watcher event');
    await delay(50);
  }
}

describe('SessionDirWatcher', () => {
  it('reports a new session file and then changes to it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ask-watch-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    const adapter = createClaudeAdapter({ sessionRoot: root, env: {} });
    const registry = new AgentRegistry().register(adapter);
    const events: SessionFileEvent[] = [];
    const watcher = new SessionDirWatcher({
      registry,
      debounceMs: 50,
      onEvent: (event) => {
        events.push(event);
      },
    });
    cleanups.push(() => watcher.dispose());

    await watcher.start();

    const projectDir = path.join(root, 'projects', '-p-api');
    await mkdir(projectDir, { recursive: true });
    const file = path.join(projectDir, 'w1.jsonl');
    const userLine = JSON.stringify({
      type: 'user',
      sessionId: 'w1',
      cwd: '/p/api',
      isMeta: false,
      timestamp: '2026-01-02T03:00:00.000Z',
      message: { role: 'user', content: 'first prompt' },
    });
    await writeFile(file, `${userLine}\n`);

    const first = await waitFor(() => events.find((event) => event.info.sessionId === 'w1'));
    expect(first.isNew).toBe(true);
    expect(first.info).toMatchObject({ sessionId: 'w1', cwd: '/p/api', firstPrompt: 'first prompt' });

    await delay(150);
    await appendFile(file, `${userLine.replace('first prompt', 'second prompt')}\n`);

    const second = await waitFor(() =>
      events.find((event) => event.info.sessionId === 'w1' && !event.isNew),
    );
    expect(second.isNew).toBe(false);
  });
});
