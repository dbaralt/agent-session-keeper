import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { HookEvent } from './events';

export interface HookSpoolReaderOptions {
  spoolDir: string;
  onEvent: (event: HookEvent) => void | Promise<void>;
  pollMs?: number;
  logger?: { info(message: string): void; warn(message: string): void };
}

/**
 * Tails the append-only hook spool and forwards each event. Polling (rather
 * than fs.watch) keeps partial lines and rotations simple to handle.
 */
export class HookSpoolReader {
  private readonly spoolDir: string;
  private readonly onEvent: (event: HookEvent) => void | Promise<void>;
  private readonly pollMs: number;
  private readonly logger: HookSpoolReaderOptions['logger'];
  private readonly offsets = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(options: HookSpoolReaderOptions) {
    this.spoolDir = options.spoolDir;
    this.onEvent = options.onEvent;
    this.pollMs = options.pollMs ?? 500;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    await mkdir(this.spoolDir, { recursive: true });
    await this.skipExisting();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollMs);
    this.logger?.info(`watching hook spool ${this.spoolDir}`);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async skipExisting(): Promise<void> {
    for (const file of await this.files()) {
      try {
        this.offsets.set(file, (await stat(file)).size);
      } catch {
        // Ignore files that disappear.
      }
    }
  }

  private async files(): Promise<string[]> {
    try {
      const entries = await readdir(this.spoolDir);
      return entries
        .filter((name) => name.startsWith('events-') && name.endsWith('.jsonl'))
        .map((name) => path.join(this.spoolDir, name));
    } catch {
      return [];
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    for (const file of await this.files()) {
      if (!existsSync(file)) continue;
      const size = (await stat(file)).size;
      // Files present at start are in `offsets`; a file created later starts at 0.
      const offset = this.offsets.get(file) ?? 0;
      if (size <= offset) continue;
      const buffer = await readFile(file);
      const chunk = buffer.subarray(offset).toString('utf8');
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline < 0) continue;
      const complete = chunk.slice(0, lastNewline);
      this.offsets.set(file, offset + Buffer.byteLength(complete, 'utf8') + 1);
      for (const line of complete.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          await this.onEvent(JSON.parse(trimmed) as HookEvent);
        } catch (error) {
          this.logger?.warn(`ignoring bad hook event in ${file}: ${String(error)}`);
        }
      }
    }
  }
}
