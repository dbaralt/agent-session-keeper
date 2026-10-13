import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WindowHeartbeatOptions {
  storageDir: string;
  windowSessionId: string;
  intervalMs?: number;
  logger?: { info(message: string): void; warn(message: string): void };
}

/** A heartbeat older than this is considered a dead window. */
export const HEARTBEAT_FRESH_MS = 90_000;

/**
 * Each window writes a small file so other windows can tell that it is still
 * alive. `detectInterrupted` uses this to avoid marking a session running in
 * another window as interrupted.
 */
export class WindowHeartbeat {
  private readonly file: string;
  private readonly windowSessionId: string;
  private readonly intervalMs: number;
  private readonly logger: WindowHeartbeatOptions['logger'];
  private timer: NodeJS.Timeout | undefined;

  constructor(options: WindowHeartbeatOptions) {
    this.file = path.join(options.storageDir, 'windows', `${options.windowSessionId}.json`);
    this.windowSessionId = options.windowSessionId;
    this.intervalMs = options.intervalMs ?? 30_000;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  async dispose(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await rm(this.file, { force: true });
  }

  private async tick(): Promise<void> {
    try {
      await writeFile(
        this.file,
        JSON.stringify({
          windowSessionId: this.windowSessionId,
          pid: process.pid,
          updatedAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
    } catch (error) {
      this.logger?.warn(`could not write window heartbeat: ${String(error)}`);
    }
  }
}

/** The window session ids whose heartbeat is still fresh (or whose pid is alive). */
export async function readFreshWindows(
  storageDir: string,
  now = Date.now(),
): Promise<Set<string>> {
  const dir = path.join(storageDir, 'windows');
  const fresh = new Set<string>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return fresh;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const full = path.join(dir, entry);
    try {
      const info = await stat(full);
      if (now - info.mtimeMs > HEARTBEAT_FRESH_MS) {
        // A stale heartbeat can still mean the process is alive (sleep/wake);
        // only drop it if its pid is gone too.
        const pid = await readPid(full);
        if (!pidAlive(pid)) {
          await rm(full, { force: true });
          continue;
        }
      }
      const id = entry.slice(0, -'.json'.length);
      if (id) fresh.add(id);
    } catch {
      // File may have been removed between readdir and stat.
    }
  }
  return fresh;
}

async function readPid(file: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { pid?: number };
    return typeof parsed.pid === 'number' ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
