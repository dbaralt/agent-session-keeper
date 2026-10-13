import path from 'node:path';
import { sessionKey, type SessionRecord } from './types';

/**
 * A readable default name for a session the user or the agent did not name.
 * E.g. `pi · api · 14:05`.
 */
export function fallbackTitle(displayName: string, cwd: string, now: Date = new Date()): string {
  const folder = cwd ? path.basename(cwd) || 'unknown' : 'unknown';
  const time = now.toISOString().slice(11, 16);
  return `${displayName} · ${folder} · ${time}`;
}

/** Titles safe to pass to an agent as `--name`: plain letters, digits and a few marks. */
export function isPlainTextTitle(value: string): boolean {
  return value.length <= 80 && /^[A-Za-z0-9 .\-_,:!?()]+$/.test(value);
}

/**
 * Make a title unique among the listed sessions by appending ` (2)`, ` (3)`, …
 * Archived records do not count because they are not listed.
 */
export function uniquifyTitle(
  desired: string,
  records: readonly SessionRecord[],
  excludeKey?: string,
): string {
  const base = desired.trim();
  const taken = new Set<string>();
  for (const record of records) {
    if (record.status === 'archived') continue;
    if (excludeKey && sessionKey(record.agent, record.sessionId) === excludeKey) continue;
    taken.add(record.title);
  }
  if (!taken.has(base)) return base;
  let n = 2;
  for (;;) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
}
