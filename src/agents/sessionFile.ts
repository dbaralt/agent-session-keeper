import { open } from 'node:fs/promises';

/** Read at most the first `maxBytes` of a file as UTF-8. */
export async function readHead(filePath: string, maxBytes = 64 * 1024): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Parse every complete JSON line in the head of a file, skipping bad lines. */
export async function readHeadJsonLines(
  filePath: string,
  maxBytes = 64 * 1024,
): Promise<unknown[]> {
  const text = await readHead(filePath, maxBytes);
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // A partial trailing line is normal when reading a file being written.
    }
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pull text out of a message content that is either a string or a parts array. */
export function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (isObject(part) && typeof part.text === 'string') return part.text;
    }
  }
  return undefined;
}

export function isIgnorablePrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('<') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('[Request interrupted')
  );
}

/** Collapse whitespace and clamp a prompt to a title. */
export function toTitle(text: string, max = 80): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > max ? single.slice(0, max) : single;
}

export { isObject };
