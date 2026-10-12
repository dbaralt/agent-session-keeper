import { homedir } from 'node:os';
import path from 'node:path';

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME?.trim() || homedir();
}

/** Expand a leading `~` in a path. */
export function expandHome(value: string, home: string = homeDir()): string {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith(`~${path.sep}`)) {
    return path.join(home, value.slice(2));
  }
  return value;
}
