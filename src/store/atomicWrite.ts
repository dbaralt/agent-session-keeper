import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Write a file so a crash can never leave half of it behind: write a temporary
 * file in the same directory, flush it, then rename it over the target.
 * Files are owner-only (0600) by default because records may contain paths and
 * prompt-derived titles.
 */
export async function writeFileAtomic(
  filePath: string,
  contents: string,
  options: { mode?: number } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const handle = await open(tmpPath, 'w', options.mode ?? 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: { mode?: number } = {},
): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}
