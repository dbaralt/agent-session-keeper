import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureStoragePermissions, resolveStorageDir } from '../../src/store/storageDir';

const home = path.sep === '/' ? '/home/tester' : 'C:\\Users\\tester';

describe('resolveStorageDir', () => {
  it('prefers AGENT_SESSIONS_STORAGE_DIR over the setting', () => {
    const dir = resolveStorageDir({
      env: { AGENT_SESSIONS_STORAGE_DIR: '/tmp/from-env' },
      settingValue: '/tmp/from-setting',
      home,
    });
    expect(dir).toBe(path.resolve('/tmp/from-env'));
  });

  it('uses the setting when the env var is absent', () => {
    const dir = resolveStorageDir({
      env: {},
      settingValue: '/tmp/from-setting',
      home,
    });
    expect(dir).toBe(path.resolve('/tmp/from-setting'));
  });

  it('defaults to ~/.agent-sessions', () => {
    expect(resolveStorageDir({ env: {}, home })).toBe(path.join(home, '.agent-sessions'));
  });

  it('treats a blank env var and setting as unset', () => {
    expect(
      resolveStorageDir({ env: { AGENT_SESSIONS_STORAGE_DIR: '   ' }, settingValue: '', home }),
    ).toBe(path.join(home, '.agent-sessions'));
  });

  it('expands a leading ~ from the setting', () => {
    expect(resolveStorageDir({ env: {}, settingValue: '~/keeper', home })).toBe(
      path.join(home, 'keeper'),
    );
  });

  it('upgrades an existing storage tree to owner-only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ask-storage-perms-'));
    try {
      const subdirs = ['sessions', 'spool', 'windows', 'bin'];
      for (const dir of [root, ...subdirs.map((name) => path.join(root, name))]) {
        await mkdir(dir, { recursive: true, mode: 0o755 });
      }
      await ensureStoragePermissions(root);
      for (const dir of [root, ...subdirs.map((name) => path.join(root, name))]) {
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
