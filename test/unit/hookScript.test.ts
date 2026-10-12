import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.join(process.cwd(), 'resources', 'hook.js');
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function runHook(input: string, env: NodeJS.ProcessEnv) {
  return execFileSync(process.execPath, [script, 'claude'], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

async function spoolLines(storageDir: string): Promise<unknown[]> {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(storageDir, 'spool', `events-${date}.jsonl`);
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

describe('resources/hook.js', () => {
  it('appends one spool line and prints nothing', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'ask-hook-'));
    tempDirs.push(storageDir);

    const stdout = runHook(
      JSON.stringify({
        hook_event_name: 'SessionStart',
        source: 'startup',
        session_id: 'abc-123',
        transcript_path: '/tmp/abc-123.jsonl',
        cwd: '/p/api',
      }),
      { AGENT_SESSIONS_STORAGE_DIR: storageDir, AGENT_SESSIONS_TERMINAL_ID: 'claude/abc-123' },
    );

    expect(stdout).toBe('');
    const lines = await spoolLines(storageDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      agent: 'claude',
      event: 'SessionStart',
      source: 'startup',
      session_id: 'abc-123',
      transcript_path: '/tmp/abc-123.jsonl',
      cwd: '/p/api',
      terminalId: 'claude/abc-123',
    });
    expect(Array.isArray((lines[0] as { ancestorPids: unknown }).ancestorPids)).toBe(true);
  });

  it('exits 0 and writes nothing for malformed input', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'ask-hook-bad-'));
    tempDirs.push(storageDir);
    const stdout = runHook('this is not json', { AGENT_SESSIONS_STORAGE_DIR: storageDir });
    expect(stdout).toBe('');
    const lines = await spoolLines(storageDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ agent: 'claude', event: 'unknown' });
  });
});
