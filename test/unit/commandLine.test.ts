import { describe, expect, it } from 'vitest';
import {
  commandName,
  findFlagValue,
  hasAnyFlag,
  normalizeCommandLine,
  stripWrappers,
  tokenize,
} from '../../src/agents/commandLine';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('claude --resume abc')).toEqual(['claude', '--resume', 'abc']);
  });

  it('keeps quoted arguments together', () => {
    expect(tokenize('claude -n "My Session" --session-id x')).toEqual([
      'claude',
      '-n',
      'My Session',
      '--session-id',
      'x',
    ]);
    expect(tokenize("claude --name 'single quoted'")).toEqual([
      'claude',
      '--name',
      'single quoted',
    ]);
  });

  it('honours backslash escapes', () => {
    expect(tokenize('claude --name a\\ b')).toEqual(['claude', '--name', 'a b']);
  });

  it('collapses repeated whitespace and ignores empty tokens', () => {
    expect(tokenize('  claude    --resume   abc ')).toEqual(['claude', '--resume', 'abc']);
  });
});

describe('commandName', () => {
  it('takes the basename', () => {
    expect(commandName('/usr/local/bin/claude')).toBe('claude');
    expect(commandName('C:\\tools\\pi.exe')).toBe('pi');
  });

  it('strips script suffixes', () => {
    expect(commandName('claude.cmd')).toBe('claude');
    expect(commandName('pi.ps1')).toBe('pi');
  });
});

describe('stripWrappers', () => {
  it('removes a leading env assignment', () => {
    expect(stripWrappers(['FOO=1', 'claude'])).toEqual(['claude']);
  });

  it('removes env and its assignments', () => {
    expect(stripWrappers(['env', 'FOO=1', 'BAR=2', 'claude'])).toEqual(['claude']);
  });

  it('removes npx, bunx and pnpx', () => {
    expect(stripWrappers(['npx', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['npx', '-y', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['bunx', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['pnpx', 'claude'])).toEqual(['claude']);
  });

  it('removes pnpm/yarn dlx and npm exec', () => {
    expect(stripWrappers(['pnpm', 'dlx', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['yarn', 'dlx', 'pi'])).toEqual(['pi']);
    expect(stripWrappers(['npm', 'exec', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['npm', 'x', '--', 'pi'])).toEqual(['pi']);
  });

  it('removes sudo and command', () => {
    expect(stripWrappers(['sudo', '-u', 'root', 'claude'])).toEqual(['claude']);
    expect(stripWrappers(['command', 'claude'])).toEqual(['claude']);
  });

  it('leaves a plain command alone', () => {
    expect(stripWrappers(['claude', '--resume', 'abc'])).toEqual(['claude', '--resume', 'abc']);
  });
});

describe('normalizeCommandLine', () => {
  it('tokenizes and strips in one step', () => {
    expect(normalizeCommandLine('FOO=1 npx -y claude --resume abc')).toEqual([
      'claude',
      '--resume',
      'abc',
    ]);
  });
});

describe('findFlagValue', () => {
  const argv = ['claude', '--name', 'Session', '--session-id=abc', '-r', 'xyz'];

  it('reads a value after the flag', () => {
    expect(findFlagValue(argv, ['--name', '-n'])).toEqual({ present: true, value: 'Session' });
  });

  it('reads --flag=value', () => {
    expect(findFlagValue(argv, ['--session-id'])).toEqual({ present: true, value: 'abc' });
  });

  it('reads a short flag value', () => {
    expect(findFlagValue(argv, ['--resume', '-r'])).toEqual({ present: true, value: 'xyz' });
  });

  it('reports a flag with no value', () => {
    expect(findFlagValue(['claude', '--resume'], ['--resume', '-r'])).toEqual({ present: true });
  });

  it('reports absence', () => {
    expect(findFlagValue(['claude'], ['--resume'])).toEqual({ present: false });
  });
});

describe('hasAnyFlag', () => {
  it('finds flags and --flag=value forms', () => {
    expect(hasAnyFlag(['claude', '--continue'], ['--continue', '-c'])).toBe(true);
    expect(hasAnyFlag(['claude', '--print=1'], ['--print'])).toBe(true);
    expect(hasAnyFlag(['claude'], ['--continue'])).toBe(false);
  });
});
