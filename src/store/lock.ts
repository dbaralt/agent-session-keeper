import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export interface FileLockOptions {
  /** Give up and throw after this long. */
  timeoutMs?: number;
  /** Treat a lock directory older than this as abandoned. */
  staleMs?: number;
  /** Base delay between attempts; a little jitter is added. */
  pollMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process mutual exclusion built on an atomic `mkdir`. Used so two VS
 * Code windows doing read-merge-write on the same record cannot lose a field.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 15_000;
  const pollMs = options.pollMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  // The lock directory is a sibling of the target file, so it may not exist yet.
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock disappeared between mkdir and stat; try again.
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring lock: ${lockPath}`);
      }
      await sleep(pollMs + Math.floor(Math.random() * pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
