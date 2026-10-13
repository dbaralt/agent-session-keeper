import { realpathSync } from 'node:fs';
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

/** Resolve symlinks when possible, so `/var` and `/private/var` compare equal. */
export function canonicalPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function pathsEqual(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}

/** True if `filePath` is `root` or inside it. */
export function isUnder(filePath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  return (
    resolvedFile === resolvedRoot ||
    resolvedFile.startsWith(resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`)
  );
}
