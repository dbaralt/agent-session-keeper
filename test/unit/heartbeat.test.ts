import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFreshWindows } from '../../src/restore/heartbeat';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function makeHeartbeat(root: string, id: string, pid: number): Promise<void> {
  const dir = path.join(root, 'windows');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({ windowSessionId: id, pid, updatedAt: new Date().toISOString() }),
  );
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(path.join(dir, `${id}.json`), old, old);
}

describe('readFreshWindows', () => {
  it('keeps a stale heartbeat whose pid is still alive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ask-hb-'));
    tempDirs.push(root);
    await makeHeartbeat(root, 'w-alive', process.pid);
    const fresh = await readFreshWindows(root);
    expect(fresh.has('w-alive')).toBe(true);
  });

  it('drops a stale heartbeat whose pid is dead', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ask-hb-'));
    tempDirs.push(root);
    await makeHeartbeat(root, 'w-dead', 999999);
    const fresh = await readFreshWindows(root);
    expect(fresh.has('w-dead')).toBe(false);
  });
});
