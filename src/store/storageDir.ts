import { homedir } from 'node:os';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from '../util/paths';

export interface ResolveStorageDirOptions {
  env?: NodeJS.ProcessEnv;
  /** The `agentSessions.storageDir` setting, if the user set it. */
  settingValue?: string;
  /** Home directory fallback for tests. */
  home?: string;
}

/**
 * The one place that decides where records live.
 *
 * Precedence: `AGENT_SESSIONS_STORAGE_DIR` env var → `agentSessions.storageDir`
 * setting → `~/.agent-sessions`. Keeping this in a single function makes a
 * future per-project mode a small change (see PROGRESS.md, decision D3).
 */
export function resolveStorageDir(options: ResolveStorageDirOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.home ?? env.HOME ?? homedir();

  const fromEnv = env.AGENT_SESSIONS_STORAGE_DIR?.trim();
  if (fromEnv) return path.resolve(expandHome(fromEnv, home));

  const fromSetting = options.settingValue?.trim();
  if (fromSetting) return path.resolve(expandHome(fromSetting, home));

  return path.join(home, '.agent-sessions');
}

/**
 * Make an existing storage tree owner-only. New dirs are created 0700 already;
 * this upgrades a storage dir made by an older version (0755/0644).
 */
export async function ensureStoragePermissions(storageDir: string): Promise<void> {
  const dirs = [
    storageDir,
    path.join(storageDir, 'sessions'),
    path.join(storageDir, 'spool'),
    path.join(storageDir, 'windows'),
    path.join(storageDir, 'bin'),
  ];
  for (const dir of dirs) {
    try {
      await chmod(dir, 0o700);
    } catch {
      // Missing dirs are fine; they will be created with the right mode.
    }
  }
}
