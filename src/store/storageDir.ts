import { homedir } from 'node:os';
import path from 'node:path';

export interface ResolveStorageDirOptions {
  env?: NodeJS.ProcessEnv;
  /** The `agentSessions.storageDir` setting, if the user set it. */
  settingValue?: string;
  /** Home directory fallback for tests. */
  home?: string;
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(home, value.slice(2));
  }
  return value;
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
