import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore, type SessionChange } from '../../src/store/SessionStore';
import { makeRecord } from './helpers/records';

const tempDirs: string[] = [];
const stores: SessionStore[] = [];

async function makeStore(): Promise<SessionStore> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ask-store-'));
  tempDirs.push(rootDir);
  const store = new SessionStore({ rootDir });
  stores.push(store);
  return store;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(25);
  }
}

afterEach(async () => {
  while (stores.length > 0) await stores.pop()?.dispose();
  while (tempDirs.length > 0) await rm(tempDirs.pop() as string, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('creates a record and writes it to disk', async () => {
    const store = await makeStore();
    await store.init();
    const record = makeRecord({ sessionId: 'abc', title: 'First' });

    await store.upsert(record);

    expect(store.get('claude', 'abc')?.title).toBe('First');
    expect(store.all()).toHaveLength(1);
    const files = await readdir(path.join(store.sessionsDir, 'claude'));
    expect(files).toEqual(['abc.json']);
  });

  it('loads existing records on init', async () => {
    const first = await makeStore();
    await first.init();
    await first.upsert(makeRecord({ sessionId: 'abc' }));
    await first.dispose();

    const second = new SessionStore({ rootDir: first.rootDir });
    stores.push(second);
    await second.init();

    expect(second.get('claude', 'abc')).toBeDefined();
  });

  it('updates one field without touching the others', async () => {
    const store = await makeStore();
    await store.init();
    await store.upsert(makeRecord({ sessionId: 'abc', title: 'A', gitBranch: 'main' }));

    const updated = await store.update('claude', 'abc', { title: 'B' });

    expect(updated?.title).toBe('B');
    expect(updated?.gitBranch).toBe('main');
    expect(updated?.updatedAt).not.toBe(undefined);
    expect(store.get('claude', 'abc')?.title).toBe('B');
  });

  it('returns undefined when updating a record that does not exist', async () => {
    const store = await makeStore();
    await store.init();
    expect(await store.update('claude', 'nope', { title: 'x' })).toBeUndefined();
  });

  it('merges field by field, newer updatedAt wins, older values survive', async () => {
    const store = await makeStore();
    await store.init();
    await store.upsert(
      makeRecord({
        sessionId: 'abc',
        title: 'Old',
        status: 'running',
        gitBranch: 'feat/x',
        notes: 'keep me',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    await store.upsert(
      makeRecord({
        sessionId: 'abc',
        title: 'New',
        status: 'exited',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    expect(store.get('claude', 'abc')).toMatchObject({
      title: 'New',
      status: 'exited',
      gitBranch: 'feat/x',
      notes: 'keep me',
    });

    // A stale full record must not overwrite the newer one.
    await store.upsert(
      makeRecord({ sessionId: 'abc', title: 'Stale', updatedAt: '2025-12-31T00:00:00.000Z' }),
    );
    expect(store.get('claude', 'abc')?.title).toBe('New');
  });

  it('deletes a record from memory and disk', async () => {
    const store = await makeStore();
    await store.init();
    await store.upsert(makeRecord({ sessionId: 'abc' }));

    await store.delete('claude', 'abc');

    expect(store.get('claude', 'abc')).toBeUndefined();
    expect(store.all()).toHaveLength(0);
    expect(await readdir(path.join(store.sessionsDir, 'claude'))).toEqual([]);
  });

  it('leaves no temporary files behind after an atomic write', async () => {
    const store = await makeStore();
    await store.init();
    await store.upsert(makeRecord({ sessionId: 'abc' }));

    const files = await readdir(path.join(store.sessionsDir, 'claude'));
    expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });

  it('creates records and directories owner-only', async () => {
    const store = await makeStore();
    await store.init();
    await store.upsert(makeRecord({ sessionId: 'abc' }));

    const fileStat = await stat(path.join(store.sessionsDir, 'claude', 'abc.json'));
    const dirStat = await stat(store.sessionsDir);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it('notifies a second window when a record changes', async () => {
    const windowA = await makeStore();
    const windowB = new SessionStore({ rootDir: windowA.rootDir });
    stores.push(windowB);
    await windowA.init();
    await windowB.init();
    await delay(250);

    const changes: SessionChange[] = [];
    windowA.onDidChange((change) => changes.push(change));

    await windowB.upsert(makeRecord({ sessionId: 'from-b', title: 'From B' }));
    const upsert = await waitFor(() =>
      changes.find((change) => change.type === 'upsert' && change.key === 'claude/from-b'),
    );
    expect(upsert.type).toBe('upsert');
    expect(windowA.get('claude', 'from-b')?.title).toBe('From B');

    await windowB.delete('claude', 'from-b');
    const removed = await waitFor(() =>
      changes.find((change) => change.type === 'delete' && change.key === 'claude/from-b'),
    );
    expect(removed.type).toBe('delete');
    expect(windowA.get('claude', 'from-b')).toBeUndefined();
  });
});
