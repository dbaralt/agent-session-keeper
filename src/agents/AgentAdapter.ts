import type { AgentId, SessionFileInfo, SessionRecord } from '../model/types';

export interface CommandMatch {
  /** False for one-shot runs such as `-p`/`--print`, `mcp`, `login`, `install`. */
  interactive: boolean;
  /** Session id named on the command line, if any. */
  explicitSessionId?: string;
  /** True for `--resume`, `-r`, `--continue`, `-c`, `resume`, `--session`. */
  isResume: boolean;
  /** Display name given with `-n`/`--name`. */
  name?: string;
}

export interface NewSessionOptions {
  sessionId?: string;
  name?: string;
}

/**
 * Everything agent-specific lives behind this interface. Adding a harness is one
 * new file that implements it plus one line in the registry.
 */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly displayName: string;
  /** Codicon id, without the leading `$( )`. */
  readonly icon: string;
  readonly supportsPresetId: boolean;
  readonly defaultPatterns: readonly string[];
  /** Match a full command line (wrappers already stripped inside the adapter). */
  matchCommand(argv: string[]): CommandMatch | undefined;
  /** Directories the folder watcher should watch for this agent. */
  sessionRoots(): string[];
  isSessionFile(filePath: string): boolean;
  readSessionFile(filePath: string): Promise<SessionFileInfo | undefined>;
  fileBelongsToCwd(filePath: string, info: SessionFileInfo, cwd: string): boolean;
  transcriptPathFor(record: SessionRecord): Promise<string | undefined>;
  buildNewCommand(options: NewSessionOptions): string;
  buildResumeCommand(record: SessionRecord, template?: string): string;
}

/** Replace the `${sessionId}`, `${cwd}` and `${title}` placeholders. */
export function applyResumeTemplate(template: string, record: SessionRecord): string {
  return template
    .replaceAll('${sessionId}', record.sessionId)
    .replaceAll('${cwd}', record.cwd)
    .replaceAll('${title}', record.title);
}
