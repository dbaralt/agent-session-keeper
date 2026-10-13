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
  /** Already owned by this window. */
  stillRunning: SessionRecord[];
  /** Owned by another window but a live terminal in this window matched it. */
  rebound: SessionRecord[];
  /** Owned by another window whose heartbeat is still fresh. */
  aliveElsewhere: SessionRecord[];
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
 * for restore. A record whose owning window still heartbeats is left alone.
 */
export function detectInterrupted(
  records: readonly SessionRecord[],
  currentWindowSessionId: string,
  liveTerminals: readonly LiveTerminal[],
  freshWindowIds: ReadonlySet<string> = new Set(),
): InterruptedDetection {
  const interrupted: SessionRecord[] = [];
  const stillRunning: SessionRecord[] = [];
  const rebound: SessionRecord[] = [];
  const aliveElsewhere: SessionRecord[] = [];

  for (const record of records) {
    if (record.status !== 'running' && record.status !== 'pending') continue;
    if (record.launch.windowSessionId === currentWindowSessionId) {
      stillRunning.push(record);
      continue;
    }
    if (findLiveTerminal(record, liveTerminals)) {
      rebound.push(record);
      continue;
    }
    // A fresh heartbeat means that window is still alive, even if this window
    // cannot see its terminals.
    if (record.launch.windowSessionId && freshWindowIds.has(record.launch.windowSessionId)) {
      aliveElsewhere.push(record);
      continue;
    }
    interrupted.push(record);
  }

  return { interrupted, stillRunning, rebound, aliveElsewhere };
}

export { findLiveTerminal };
