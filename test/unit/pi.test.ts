import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPiAdapter } from '../../src/agents/pi';
import { tokenize } from '../../src/agents/commandLine';
import type { CommandMatch } from '../../src/agents/AgentAdapter';

const fixtures = path.join(process.cwd(), 'test/fixtures/pi');
const sessionsDir = path.join(fixtures, 'sessions');
const adapter = createPiAdapter({ sessionDir: sessionsDir, env: {} });

interface Expected {
  interactive: boolean;
  isResume: boolean;
  explicitSessionId?: string | undefined;
  name?: string | undefined;
}

function normalize(match: CommandMatch | undefined): Expected | undefined {
  if (!match) return undefined;
  return {
    interactive: match.interactive,
    isResume: match.isResume,
    explicitSessionId: match.explicitSessionId,
    name: match.name,
  };
}

function match(line: string): Expected | undefined {
  return normalize(adapter.matchCommand(tokenize(line)));
}

describe('pi command matching', () => {
  const cases: [string, Expected | undefined][] = [
    ['pi', { interactive: true, isResume: false }],
    ['pi -n "My Session"', { interactive: true, isResume: false, name: 'My Session' }],
    ['pi --name "Renamed"', { interactive: true, isResume: false, name: 'Renamed' }],
    ['pi --session-id abc-123', { interactive: true, isResume: false, explicitSessionId: 'abc-123' }],
    ['pi --session abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['pi --session=abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['pi --resume abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['pi -r abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['pi --fork abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['pi -c', { interactive: true, isResume: true }],
    ['pi --continue', { interactive: true, isResume: true }],
    ['pi --session', { interactive: true, isResume: true }],
    ['pi --model gpt-x', { interactive: true, isResume: false }],
    ['pi --session-dir /tmp/x', { interactive: true, isResume: false }],
    ['pi -p "hello"', { interactive: false, isResume: false }],
    ['pi --print', { interactive: false, isResume: false }],
    ['pi --help', { interactive: false, isResume: false }],
    ['pi -h', { interactive: false, isResume: false }],
    ['pi --version', { interactive: false, isResume: false }],
    ['pi install x', { interactive: false, isResume: false }],
    ['pi export file.jsonl out.html', { interactive: false, isResume: false }],
    ['pi login', { interactive: false, isResume: false }],
    ['env FOO=1 pi --session abc', { interactive: true, isResume: true, explicitSessionId: 'abc' }],
    ['npx -y @earendil-works/pi-coding-agent', { interactive: true, isResume: false }],
    ['claude', undefined],
    ['codex', undefined],
  ];

  for (const [line, expected] of cases) {
    it(`matches: ${line}`, () => {
      expect(match(line)).toEqual(expected);
    });
  }
});

describe('pi session file reader', () => {
  const file = path.join(
    sessionsDir,
    '--Users-me-code-api--/2026-01-02T03-04-05-000Z_c0ffee00-0000-4000-8000-000000000002.jsonl',
  );

  it('reads id, cwd, name and first prompt from the header', async () => {
    const info = await adapter.readSessionFile(file);
    expect(info).toMatchObject({
      sessionId: 'c0ffee00-0000-4000-8000-000000000002',
      cwd: '/Users/me/code/api',
      startedAt: '2026-01-02T03:04:05.000Z',
      name: 'health check',
      firstPrompt: 'add a health check endpoint',
    });
  });

  it('matches a session file to its cwd using the header', () => {
    expect(
      adapter.fileBelongsToCwd(file, { sessionId: 'x', cwd: '/Users/me/code/api' }, '/Users/me/code/api'),
    ).toBe(true);
    expect(
      adapter.fileBelongsToCwd(file, { sessionId: 'x', cwd: '/Users/me/code/api' }, '/Users/me/other'),
    ).toBe(false);
  });

  it('matches using the encoded folder when the header has no cwd', () => {
    expect(
      adapter.fileBelongsToCwd(file, { sessionId: 'x' }, '/Users/me/code/api'),
    ).toBe(true);
  });

  it('resolves the transcript path from the record', async () => {
    const found = await adapter.transcriptPathFor({
      agent: 'pi',
      sessionId: 'c0ffee00-0000-4000-8000-000000000002',
      cwd: '/Users/me/code/api',
    } as never);
    expect(found).toBe(file);
  });

  it('does not trust a transcript path outside the session root', async () => {
    const found = await adapter.transcriptPathFor({
      agent: 'pi',
      sessionId: 'nope',
      cwd: '/Users/me/code/api',
      transcriptPath: '/etc/hosts',
    } as never);
    expect(found).toBeUndefined();
  });

  it('matches a custom alias pattern', () => {
    const custom = createPiAdapter({ env: {}, patterns: ['pp'] });
    expect(normalize(custom.matchCommand(tokenize('pp --session abc')))).toEqual({
      interactive: true,
      isResume: true,
      explicitSessionId: 'abc',
    });
  });

  it('treats a session by path as a pending resume, not an id', () => {
    expect(match('pi --session /path/to/session.jsonl')).toEqual({
      interactive: true,
      isResume: true,
      explicitSessionId: undefined,
      name: undefined,
    });
  });

  it('builds commands', () => {
    expect(adapter.buildNewCommand({ sessionId: 'abc', name: 'My Session' })).toBe(
      "pi --session-id abc --name 'My Session'",
    );
    expect(
      adapter.buildResumeCommand({ sessionId: 'abc', cwd: '/x', title: 'T' } as never),
    ).toBe('pi --session abc');
  });
});
