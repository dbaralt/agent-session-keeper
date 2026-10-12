import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/store/SessionStore';
import { makeRecord } from './helpers/records';

const run = promisify(execFile);
const repoRoot = process.cwd();
const tmpDir = path.join(repoRoot, 'test/.tmp');
const bundlePath = path.join(tmpDir, 'update-field.mjs');

beforeAll(async () => {
  await mkdir(tmpDir, { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, 'test/unit/helpers/updateField.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: bundlePath,
    logLevel: 'silent',
  });
}, 60_000);

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('two writer processes on one record', () => {
  it('keeps the fields written by both processes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ask-concurrency-'));
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';

    const setup = new SessionStore({ rootDir });
    await setup.init();
    await setup.upsert(
      makeRecord({ sessionId, title: 'base title', notes: 'base notes' }),
    );
    await setup.dispose();

    // Both children wake at the same instant and race for the same file.
    const startAt = Date.now() + 800;
    const child = (field: string, value: string) =>
      run(process.execPath, [
        bundlePath,
        rootDir,
        'claude',
        sessionId,
        field,
        value,
        String(startAt),
      ]);

    await Promise.all([child('title', 'Title from A'), child('notes', 'Notes from B')]);

    const reader = new SessionStore({ rootDir });
    await reader.reload();
    const record = reader.get('claude', sessionId);
    await reader.dispose();
    await rm(rootDir, { recursive: true, force: true });

    expect(record?.title).toBe('Title from A');
    expect(record?.notes).toBe('Notes from B');
  }, 30_000);
});
