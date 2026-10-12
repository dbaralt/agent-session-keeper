import type { SessionRecord } from '../model/types';

/** A terminal that is still alive in this window when the extension activates. */
export interface LiveTerminal {
  key: string;
  shellPid?: number;
  name?: string;
}

export interface InterruptedDetection {
  /** Was running when VS Code went away and has no live terminal. */
  interrupted: SessionRecord[];
  /** Was running and still has a matching live terminal (e.g. after a reload). */
  stillRunning: SessionRecord[];
}

function findLiveTerminal(
  record: SessionRecord,
  liveTerminals: readonly LiveTerminal[],
): LiveTerminal | undefined {
  const pid = record.launch.shellPid;
  if (pid !== undefined) {
    const byPid = liveTerminals.find((terminal) => terminal.shellPid === pid);
    if (byPid) return byPid;
  }
  const name = record.launch.terminalName;
  if (name) return liveTerminals.find((terminal) => terminal.name === name);
  return undefined;
}

/**
 * Decide which records were interrupted. A window reload keeps terminals alive,
 * so a record whose shell pid is still present is rebound rather than offered
 * for restore.
 */
export function detectInterrupted(
  records: readonly SessionRecord[],
  currentWindowSessionId: string,
  liveTerminals: readonly LiveTerminal[],
): InterruptedDetection {
  const interrupted: SessionRecord[] = [];
  const stillRunning: SessionRecord[] = [];

  for (const record of records) {
    if (record.status !== 'running' && record.status !== 'pending') continue;
    if (record.launch.windowSessionId === currentWindowSessionId) {
      stillRunning.push(record);
      continue;
    }
    if (findLiveTerminal(record, liveTerminals)) {
      stillRunning.push(record);
    } else {
      interrupted.push(record);
    }
  }

  return { interrupted, stillRunning };
}

export { findLiveTerminal };
