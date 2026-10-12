import path from 'node:path';

/**
 * Split a shell command line into argv, honouring single quotes, double quotes
 * and backslash escapes. Good enough for the command lines a shell reports; it
 * is not a full POSIX shell parser.
 */
export function tokenize(commandLine: string): string[] {
  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let hasToken = false;

  for (let i = 0; i < commandLine.length; i += 1) {
    const char = commandLine[i]!;
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '\\' && quote === '"' && i + 1 < commandLine.length) {
        current += commandLine[i + 1];
        i += 1;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
    } else if (char === '\\' && i + 1 < commandLine.length) {
      current += commandLine[i + 1];
      i += 1;
      hasToken = true;
    } else if (/\s/.test(char)) {
      if (hasToken) {
        argv.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += char;
      hasToken = true;
    }
  }
  if (hasToken) argv.push(current);
  return argv;
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SCRIPT_SUFFIXES = ['.cmd', '.exe', '.ps1', '.js', '.mjs', '.cjs'];

/** The executable name from a token, ignoring any directory and extension. */
export function commandName(token: string): string {
  const base = path.basename(token.replace(/\\/g, '/'));
  for (const suffix of SCRIPT_SUFFIXES) {
    if (base.toLowerCase().endsWith(suffix)) return base.slice(0, -suffix.length);
  }
  return base;
}

const WRAPPER_COMMANDS = new Set(['command', 'nocache', 'sudo']);

/**
 * Strip the wrappers people commonly launch an agent through: environment
 * assignments, `env`, `sudo`, `npx`/`bunx`/`pnpx` and `pnpm dlx`/`npm exec`.
 */
export function stripWrappers(argv: string[]): string[] {
  let rest = [...argv];
  for (;;) {
    const first = rest[0];
    if (first === undefined) return rest;
    const name = commandName(first);

    if (ENV_ASSIGNMENT.test(first)) {
      rest = rest.slice(1);
      continue;
    }
    if (name === 'env') {
      rest = rest.slice(1);
      while (rest[0] !== undefined && (ENV_ASSIGNMENT.test(rest[0]) || rest[0].startsWith('-'))) {
        rest = rest.slice(1);
      }
      continue;
    }
    if (WRAPPER_COMMANDS.has(name)) {
      rest = rest.slice(1);
      const valueFlags = new Set([
        '-u',
        '--user',
        '-g',
        '--group',
        '-h',
        '--host',
        '-p',
        '--prompt',
        '-r',
        '--role',
        '-t',
        '--type',
        '-U',
        '--other-user',
        '-C',
        '--close-from',
      ]);
      while (rest[0]?.startsWith('-')) {
        const flag = rest[0];
        rest = rest.slice(1);
        if (valueFlags.has(flag) && rest[0] !== undefined && !rest[0].startsWith('-')) {
          rest = rest.slice(1);
        }
      }
      continue;
    }
    if (name === 'npx' || name === 'bunx' || name === 'pnpx') {
      rest = rest.slice(1);
      while (rest[0]?.startsWith('-')) rest = rest.slice(1);
      if (rest[0] === '--') rest = rest.slice(1);
      continue;
    }
    if ((name === 'pnpm' || name === 'yarn') && rest[1] === 'dlx') {
      rest = rest.slice(2);
      if (rest[0] === '--') rest = rest.slice(1);
      continue;
    }
    if (name === 'npm' && (rest[1] === 'exec' || rest[1] === 'x')) {
      rest = rest.slice(2);
      if (rest[0] === '--') rest = rest.slice(1);
      continue;
    }
    return rest;
  }
}

/** Tokenize and strip wrappers in one step. */
export function normalizeCommandLine(commandLine: string): string[] {
  return stripWrappers(tokenize(commandLine));
}

export interface FlagValue {
  present: boolean;
  value?: string;
}

/** Find `--flag value`, `--flag=value` or a short `-f value`. */
export function findFlagValue(argv: string[], names: readonly string[]): FlagValue {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    for (const name of names) {
      if (token === name) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) return { present: true, value: next };
        return { present: true };
      }
      if (name.startsWith('--') && token.startsWith(`${name}=`)) {
        return { present: true, value: token.slice(name.length + 1) };
      }
    }
  }
  return { present: false };
}

export function hasAnyFlag(argv: string[], names: readonly string[]): boolean {
  return names.some((name) =>
    argv.some((token) => token === name || (name.startsWith('--') && token.startsWith(`${name}=`))),
  );
}
