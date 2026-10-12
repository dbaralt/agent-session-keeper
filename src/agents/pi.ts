import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { SessionFileInfo, SessionRecord } from '../model/types';
import { expandHome, homeDir, pathsEqual } from '../util/paths';
import {
  applyResumeTemplate,
  type AgentAdapter,
  type CommandMatch,
  type NewSessionOptions,
} from './AgentAdapter';
import { commandName, findFlagValue, hasAnyFlag, stripWrappers } from './commandLine';
import {
  isIgnorablePrompt,
  isObject,
  readHeadJsonLines,
  textFromContent,
  toTitle,
} from './sessionFile';

const DEFAULT_PATTERNS = ['pi', 'pi-coding-agent'] as const;
const NON_INTERACTIVE_SUBCOMMANDS = new Set([
  'install',
  'update',
  'uninstall',
  'export',
  'auth',
  'login',
  'logout',
  'models',
  'config',
]);
const NON_INTERACTIVE_FLAGS = ['-p', '--print', '-h', '--help', '-v', '--version'];
const DEFAULT_RESUME_COMMAND = 'pi --session ${sessionId}';

export interface PiAdapterOptions {
  env?: NodeJS.ProcessEnv;
  /** Overrides the pi agent directory (the parent of `sessions/`). */
  sessionRoot?: string;
  /** Overrides the sessions directory itself. */
  sessionDir?: string;
  patterns?: readonly string[];
}

function agentDir(options: PiAdapterOptions): string {
  const env = options.env ?? process.env;
  const home = homeDir(env);
  const override = options.sessionRoot?.trim();
  if (override) return expandHome(override, home);
  const fromEnv = env.PI_CODING_AGENT_DIR?.trim();
  if (fromEnv) return expandHome(fromEnv, home);
  return path.join(home, '.pi', 'agent');
}

function sessionsDir(options: PiAdapterOptions): string {
  const env = options.env ?? process.env;
  const home = homeDir(env);
  const override = options.sessionDir?.trim();
  if (override) return path.resolve(expandHome(override, home));
  const fromEnv = env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (fromEnv) return path.resolve(expandHome(fromEnv, home));
  return path.join(agentDir(options), 'sessions');
}

/** Candidate folder names pi may use for a cwd. */
export function encodePiDirCandidates(cwd: string): string[] {
  const normalized = cwd.replace(/\\/g, '/');
  const joined = normalized.split('/').filter(Boolean).join('-');
  return [...new Set([`--${joined}--`, `--${joined.replace(/[^A-Za-z0-9-]/g, '-')}--`, joined])];
}

function isNonInteractive(args: string[]): boolean {
  if (hasAnyFlag(args, NON_INTERACTIVE_FLAGS)) return true;
  const first = args[0];
  return first !== undefined && !first.startsWith('-') && NON_INTERACTIVE_SUBCOMMANDS.has(first);
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function createPiAdapter(options: PiAdapterOptions = {}): AgentAdapter {
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_PATTERNS;

  return {
    id: 'pi',
    displayName: 'pi',
    icon: 'symbol-method',
    supportsPresetId: true,
    defaultPatterns: DEFAULT_PATTERNS,

    matchCommand(argv: string[]): CommandMatch | undefined {
      const rest = stripWrappers(argv);
      const head = rest[0];
      if (head === undefined || !patterns.includes(commandName(head))) return undefined;

      const args = rest.slice(1);
      const sessionId = findFlagValue(args, ['--session-id']).value;
      const resume = findFlagValue(args, ['--session', '--resume', '-r', '--fork']);
      const isResume = resume.present || hasAnyFlag(args, ['--continue', '-c']);
      const match: CommandMatch = { interactive: !isNonInteractive(args), isResume };

      const id = sessionId ?? resume.value;
      if (id) match.explicitSessionId = id;
      const name = findFlagValue(args, ['--name', '-n']).value;
      if (name) match.name = name;
      return match;
    },

    sessionRoots(): string[] {
      return [sessionsDir(options)];
    },

    isSessionFile(filePath: string): boolean {
      return filePath.endsWith('.jsonl');
    },

    async readSessionFile(filePath: string): Promise<SessionFileInfo | undefined> {
      const lines = await readHeadJsonLines(filePath);
      let sessionId: string | undefined;
      let cwd: string | undefined;
      let startedAt: string | undefined;
      let name: string | undefined;
      let firstPrompt: string | undefined;

      for (const line of lines) {
        if (!isObject(line)) continue;
        if (line.type === 'session') {
          if (typeof line.id === 'string') sessionId = line.id;
          if (typeof line.cwd === 'string' && line.cwd) cwd = line.cwd;
          if (typeof line.timestamp === 'string') startedAt = line.timestamp;
        }
        if (!name) {
          const candidate =
            line.type === 'session_info' && isObject(line.data)
              ? line.data.name
              : line.name ?? line.displayName;
          if (typeof candidate === 'string' && candidate.trim()) name = candidate.trim();
        }
        if (!firstPrompt && line.type === 'message') {
          const message = isObject(line.message) ? line.message : undefined;
          if (message?.role === 'user') {
            const text = textFromContent(message.content);
            if (text && !isIgnorablePrompt(text)) firstPrompt = toTitle(text);
          }
        }
      }

      // Fall back to the id embedded in `<timestamp>_<id>.jsonl`.
      if (!sessionId) {
        const base = path.basename(filePath).replace(/\.jsonl$/, '');
        const underscore = base.lastIndexOf('_');
        sessionId = underscore >= 0 ? base.slice(underscore + 1) : base;
      }

      const info: SessionFileInfo = { sessionId };
      if (cwd) info.cwd = cwd;
      if (startedAt) info.startedAt = startedAt;
      if (name) info.name = name;
      if (firstPrompt) info.firstPrompt = firstPrompt;
      return info;
    },

    fileBelongsToCwd(filePath: string, info: SessionFileInfo, cwd: string): boolean {
      if (info.cwd) return pathsEqual(info.cwd, cwd);
      const dirName = path.basename(path.dirname(filePath));
      return encodePiDirCandidates(cwd).includes(dirName);
    },

    async transcriptPathFor(record: SessionRecord): Promise<string | undefined> {
      if (record.transcriptPath && existsSync(record.transcriptPath)) return record.transcriptPath;

      const root = sessionsDir(options);
      for (const entry of await safeReaddir(root)) {
        const dir = path.join(root, entry);
        for (const file of await safeReaddir(dir)) {
          if (file.endsWith(`_${record.sessionId}.jsonl`) || file === `${record.sessionId}.jsonl`) {
            return path.join(dir, file);
          }
        }
      }
      return undefined;
    },

    buildNewCommand({ sessionId, name }: NewSessionOptions): string {
      let command = 'pi';
      if (sessionId) command += ` --session-id ${sessionId}`;
      if (name) command += ` --name ${JSON.stringify(name)}`;
      return command;
    },

    buildResumeCommand(record: SessionRecord, template = DEFAULT_RESUME_COMMAND): string {
      return applyResumeTemplate(template, record);
    },
  };
}
