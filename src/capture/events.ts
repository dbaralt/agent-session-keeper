import type { SessionFileInfo } from '../model/types';

/** A session file that the folder watcher saw appear or change. */
export interface SessionFileEvent {
  agent: string;
  filePath: string;
  info: SessionFileInfo;
  /** File birth time, used to match a pending launch. */
  createdAtMs: number;
  /** File modification time, used for last-active. */
  modifiedAtMs: number;
  /** True the first time this file is seen in this extension session. */
  isNew: boolean;
}

/** One line from `spool/events-*.jsonl`, written by the hook bridge. */
export interface HookEvent {
  agent: string;
  event: string;
  source?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  ts?: string;
  terminalId?: string;
  ancestorPids?: number[];
}
