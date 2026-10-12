import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStorageDir } from '../../src/store/storageDir';

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
});
