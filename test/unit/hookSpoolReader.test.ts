import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HookEvent } from '../../src/capture/events';
import { HookSpoolReader } from '../../src/capture/HookSpoolReader';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for spool event');
    await delay(25);
  }
}

describe('HookSpoolReader', () => {
  it('skips existing lines and forwards appended ones', async () => {
    const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'ask-spool-'));
    tempDirs.push(spoolDir);
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(spoolDir, `events-${date}.jsonl`);

    await writeFile(file, `${JSON.stringify({ agent: 'claude', event: 'old' })}\n`);

    const events: HookEvent[] = [];
    const reader = new HookSpoolReader({
      spoolDir,
      pollMs: 25,
      onEvent: (event) => {
        events.push(event);
      },
    });
    await reader.start();
    try {
      await delay(80);
      expect(events).toHaveLength(0);

      await appendFile(file, `${JSON.stringify({ agent: 'claude', event: 'SessionStart', session_id: 's1' })}\n`);
      const event = await waitFor(() => events.find((candidate) => candidate.event === 'SessionStart'));
      expect(event).toMatchObject({ agent: 'claude', session_id: 's1' });
    } finally {
      await reader.dispose();
    }
  });
});
