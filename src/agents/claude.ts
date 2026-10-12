import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { SessionFileInfo, SessionRecord } from '../model/types';
import { expandHome, homeDir } from '../util/paths';
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

const DEFAULT_PATTERNS = ['claude', 'claude-code'] as const;
const NON_INTERACTIVE_SUBCOMMANDS = new Set([
  'mcp',
  'update',
  'doctor',
  'config',
  'install',
  'migrate-installer',
  'setup-token',
]);
const NON_INTERACTIVE_FLAGS = ['-p', '--print', '-h', '--help', '-v', '--version'];
const DEFAULT_RESUME_COMMAND = 'claude --resume ${sessionId}';

export interface ClaudeAdapterOptions {
  env?: NodeJS.ProcessEnv;
  /** Overrides the Claude config directory (the parent of `projects/`). */
  sessionRoot?: string;
  patterns?: readonly string[];
}

/** Claude names a project folder after its cwd with non-alphanumerics as `-`. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

function configDir(options: ClaudeAdapterOptions): string {
  const env = options.env ?? process.env;
  const home = homeDir(env);
  const override = options.sessionRoot?.trim();
  if (override) return expandHome(override, home);
  const fromEnv = env.CLAUDE_CONFIG_DIR?.trim();
  if (fromEnv) return expandHome(fromEnv, home);
  return path.join(home, '.claude');
}

function projectsDir(options: ClaudeAdapterOptions): string {
  return path.join(configDir(options), 'projects');
}

function isNonInteractive(args: string[]): boolean {
  if (hasAnyFlag(args, NON_INTERACTIVE_FLAGS)) return true;
  const first = args[0];
  return first !== undefined && !first.startsWith('-') && NON_INTERACTIVE_SUBCOMMANDS.has(first);
}

function matchesProjectDir(dirName: string, cwd: string): boolean {
  const encoded = encodeProjectDir(cwd);
  if (dirName === encoded) return true;
  // Claude truncates long folder names and appends a hash.
  if (dirName.length > 200 || encoded.length > 200) {
    return dirName.slice(0, 200) === encoded.slice(0, 200);
  }
  return false;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): AgentAdapter {
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_PATTERNS;

  return {
    id: 'claude',
    displayName: 'Claude Code',
    icon: 'sparkle',
    supportsPresetId: true,
    defaultPatterns: DEFAULT_PATTERNS,

    matchCommand(argv: string[]): CommandMatch | undefined {
      const rest = stripWrappers(argv);
      const head = rest[0];
      if (head === undefined || !patterns.includes(commandName(head))) return undefined;

      const args = rest.slice(1);
      const sessionId = findFlagValue(args, ['--session-id']).value;
      const resume = findFlagValue(args, ['--resume', '-r']);
      const isResume = resume.present || hasAnyFlag(args, ['--continue', '-c']);
      const match: CommandMatch = { interactive: !isNonInteractive(args), isResume };

      const id = sessionId ?? resume.value;
      if (id) match.explicitSessionId = id;
      const name = findFlagValue(args, ['--name', '-n']).value;
      if (name) match.name = name;
      return match;
    },

    sessionRoots(): string[] {
      return [projectsDir(options)];
    },

    isSessionFile(filePath: string): boolean {
      return filePath.endsWith('.jsonl');
    },

    async readSessionFile(filePath: string): Promise<SessionFileInfo | undefined> {
      const sessionId = path.basename(filePath).replace(/\.jsonl$/, '');
      const lines = await readHeadJsonLines(filePath);

      let cwd: string | undefined;
      let gitBranch: string | undefined;
      let startedAt: string | undefined;
      let name: string | undefined;
      let firstPrompt: string | undefined;

      for (const line of lines) {
        if (!isObject(line)) continue;
        if (!cwd && typeof line.cwd === 'string' && line.cwd) cwd = line.cwd;
        if (!gitBranch && typeof line.gitBranch === 'string' && line.gitBranch !== 'HEAD') {
          gitBranch = line.gitBranch;
        }
        if (!startedAt && typeof line.timestamp === 'string') startedAt = line.timestamp;
        if (!name) {
          const candidate = line.customTitle ?? line.title;
          if (typeof candidate === 'string' && candidate.trim()) name = candidate.trim();
        }
        if (!firstPrompt && line.type === 'user' && line.isMeta !== true && line.isSidechain !== true) {
          const message = isObject(line.message) ? line.message : undefined;
          const text = message ? textFromContent(message.content) : undefined;
          if (text && !isIgnorablePrompt(text)) firstPrompt = toTitle(text);
        }
      }

      const info: SessionFileInfo = { sessionId };
      if (cwd) info.cwd = cwd;
      if (startedAt) info.startedAt = startedAt;
      if (name) info.name = name;
      if (firstPrompt) info.firstPrompt = firstPrompt;
      if (gitBranch) info.gitBranch = gitBranch;
      return info;
    },

    fileBelongsToCwd(filePath: string, _info: SessionFileInfo, cwd: string): boolean {
      return matchesProjectDir(path.basename(path.dirname(filePath)), cwd);
    },

    async transcriptPathFor(record: SessionRecord): Promise<string | undefined> {
      if (record.transcriptPath && existsSync(record.transcriptPath)) return record.transcriptPath;

      const projects = projectsDir(options);
      const direct = path.join(projects, encodeProjectDir(record.cwd), `${record.sessionId}.jsonl`);
      if (existsSync(direct)) return direct;

      for (const entry of await safeReaddir(projects)) {
        const candidate = path.join(projects, entry, `${record.sessionId}.jsonl`);
        if (existsSync(candidate)) return candidate;
      }
      return undefined;
    },

    buildNewCommand({ sessionId, name }: NewSessionOptions): string {
      let command = 'claude';
      if (sessionId) command += ` --session-id ${sessionId}`;
      if (name) command += ` --name ${JSON.stringify(name)}`;
      return command;
    },

    buildResumeCommand(record: SessionRecord, template = DEFAULT_RESUME_COMMAND): string {
      return applyResumeTemplate(template, record);
    },
  };
}
