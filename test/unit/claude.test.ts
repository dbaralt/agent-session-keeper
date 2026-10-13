import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClaudeAdapter, encodeProjectDir } from '../../src/agents/claude';
import { tokenize } from '../../src/agents/commandLine';
import type { CommandMatch } from '../../src/agents/AgentAdapter';

const fixtures = path.join(process.cwd(), 'test/fixtures/claude');
const adapter = createClaudeAdapter({ sessionRoot: fixtures, env: {} });

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

describe('claude command matching', () => {
  const cases: [string, Expected | undefined][] = [
    ['claude', { interactive: true, isResume: false }],
    ['claude -n "My Session"', { interactive: true, isResume: false, name: 'My Session' }],
    ['claude --name "Renamed"', { interactive: true, isResume: false, name: 'Renamed' }],
    ['claude --session-id abc-123', { interactive: true, isResume: false, explicitSessionId: 'abc-123' }],
    ['claude --session-id=abc-123', { interactive: true, isResume: false, explicitSessionId: 'abc-123' }],
    ['claude --resume abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['claude -r abc-123', { interactive: true, isResume: true, explicitSessionId: 'abc-123' }],
    ['claude --resume', { interactive: true, isResume: true }],
    ['claude -c', { interactive: true, isResume: true }],
    ['claude --continue', { interactive: true, isResume: true }],
    ['claude --resume --fork-session', { interactive: true, isResume: true }],
    ['claude --model opus', { interactive: true, isResume: false }],
    ['claude -p "hello"', { interactive: false, isResume: false }],
    ['claude --print', { interactive: false, isResume: false }],
    ['claude --help', { interactive: false, isResume: false }],
    ['claude -h', { interactive: false, isResume: false }],
    ['claude --version', { interactive: false, isResume: false }],
    ['claude mcp list', { interactive: false, isResume: false }],
    ['claude mcp', { interactive: false, isResume: false }],
    ['claude doctor', { interactive: false, isResume: false }],
    ['claude update', { interactive: false, isResume: false }],
    ['claude config', { interactive: false, isResume: false }],
    ['env FOO=1 claude --resume abc', { interactive: true, isResume: true, explicitSessionId: 'abc' }],
    ['npx -y claude', { interactive: true, isResume: false }],
    ['npx @anthropic-ai/claude-code', { interactive: true, isResume: false }],
    ['pnpm dlx claude', { interactive: true, isResume: false }],
    ['/usr/local/bin/claude', { interactive: true, isResume: false }],
    ['codex', undefined],
    ['pi', undefined],
  ];

  for (const [line, expected] of cases) {
    it(`matches: ${line}`, () => {
      expect(match(line)).toEqual(expected);
    });
  }

  it('matches a custom alias pattern', () => {
    const custom = createClaudeAdapter({ env: {}, patterns: ['cc'] });
    expect(normalize(custom.matchCommand(tokenize('cc --resume abc')))).toEqual({
      interactive: true,
      isResume: true,
      explicitSessionId: 'abc',
    });
  });
});

describe('claude project folder encoding', () => {
  it('replaces non-alphanumerics with dashes', () => {
    expect(encodeProjectDir('/Users/me/code/api')).toBe('-Users-me-code-api');
    expect(encodeProjectDir('/Users/me/Claude Master/app')).toBe(
      '-Users-me-Claude-Master-app',
    );
  });

  it('matches a session file to its cwd', () => {
    const file = path.join(fixtures, 'projects/-Users-me-code-api/session.jsonl');
    expect(adapter.fileBelongsToCwd(file, { sessionId: 'x' }, '/Users/me/code/api')).toBe(true);
    expect(adapter.fileBelongsToCwd(file, { sessionId: 'x' }, '/Users/me/other')).toBe(false);
  });

  it('compares only the first 200 characters for long paths', () => {
    const long = `/${'a'.repeat(240)}`;
    const dirName = `${encodeProjectDir(long).slice(0, 200)}HASH`;
    const file = path.join(fixtures, 'projects', dirName, 'session.jsonl');
    expect(adapter.fileBelongsToCwd(file, { sessionId: 'x' }, long)).toBe(true);
  });
});

describe('claude session file reader', () => {
  const file = path.join(
    fixtures,
    'projects/-Users-me-code-api/c0ffee00-0000-4000-8000-000000000001.jsonl',
  );

  it('reads id, cwd, branch, start time and first real prompt', async () => {
    const info = await adapter.readSessionFile(file);
    expect(info).toMatchObject({
      sessionId: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: '/Users/me/code/api',
      gitBranch: 'feat/auth',
      startedAt: '2026-01-02T03:04:04.000Z',
      firstPrompt: 'refactor the auth middleware please',
    });
  });

  it('recognises session files', () => {
    expect(adapter.isSessionFile(path.join(fixtures, 'projects', '-p-api', 'session.jsonl'))).toBe(true);
    expect(adapter.isSessionFile(path.join(fixtures, 'projects', '-p-api', 'session.json'))).toBe(false);
  });

  it('rejects subagent and deep transcripts', () => {
    const subagent = path.join(fixtures, 'projects', '-p-api', 'main', 'subagents', 'agent-x.jsonl');
    const deep = path.join(fixtures, 'projects', '-p-api', 'main', 'something.jsonl');
    expect(adapter.isSessionFile(subagent)).toBe(false);
    expect(adapter.isSessionFile(deep)).toBe(false);
  });

  it('resolves the transcript path from the record', async () => {
    const found = await adapter.transcriptPathFor({
      agent: 'claude',
      sessionId: 'c0ffee00-0000-4000-8000-000000000001',
      cwd: '/Users/me/code/api',
    } as never);
    expect(found).toBe(file);
  });

  it('returns undefined for an unknown session', async () => {
    const missing = await adapter.transcriptPathFor({
      agent: 'claude',
      sessionId: 'nope',
      cwd: '/Users/me/code/api',
    } as never);
    expect(missing).toBeUndefined();
  });
});

describe('claude command builders', () => {
  it('builds a new session command with a preset id and name', () => {
    expect(adapter.buildNewCommand({ sessionId: 'abc', name: 'My Session' })).toBe(
      "claude --session-id abc --name 'My Session'",
    );
    expect(adapter.buildNewCommand({})).toBe('claude');
  });

  it('builds the default resume command', () => {
    expect(
      adapter.buildResumeCommand({ sessionId: 'abc', cwd: '/x', title: 'T' } as never),
    ).toBe('claude --resume abc');
  });

  it('supports a custom resume template', () => {
    expect(
      adapter.buildResumeCommand(
        { sessionId: 'abc', cwd: '/x', title: 'T' } as never,
        'cd ${cwd} && claude --resume ${sessionId} --permission-mode plan',
      ),
    ).toBe('cd /x && claude --resume abc --permission-mode plan');
  });
});
