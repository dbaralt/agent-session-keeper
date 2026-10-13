import { existsSync } from 'node:fs';
import { mkdir, open, readdir, rm, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { HookEvent } from './events';

export interface HookSpoolReaderOptions {
  spoolDir: string;
  onEvent: (event: HookEvent) => void | Promise<void>;
  pollMs?: number;
  retentionDays?: number;
  logger?: { info(message: string): void; warn(message: string): void };
}

const SPOOL_FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * Tails the append-only hook spool and forwards each event. Reads incrementally
 * from per-file offsets (never the whole file) and prunes old spool files.
 */
export class HookSpoolReader {
  private readonly spoolDir: string;
  private readonly onEvent: (event: HookEvent) => void | Promise<void>;
  private readonly pollMs: number;
  private readonly retentionDays: number;
  private readonly logger: HookSpoolReaderOptions['logger'];
  private readonly offsets = new Map<string, number>();
  private readonly handles = new Map<string, FileHandle>();
  private timer: NodeJS.Timeout | undefined;
  private lastPruneDay: string | undefined;
  private disposed = false;

  constructor(options: HookSpoolReaderOptions) {
    this.spoolDir = options.spoolDir;
    this.onEvent = options.onEvent;
    this.pollMs = options.pollMs ?? 500;
    this.retentionDays = options.retentionDays ?? 7;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    await mkdir(this.spoolDir, { recursive: true, mode: 0o700 });
    this.lastPruneDay = new Date().toISOString().slice(0, 10);
    await this.pruneOldFiles();
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
    for (const handle of this.handles.values()) {
      await handle.close().catch(() => undefined);
    }
    this.handles.clear();
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

  private async pruneOldFiles(): Promise<void> {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const file of await this.files()) {
      const name = path.basename(file);
      const match = SPOOL_FILE.exec(name);
      if (!match?.[1]) continue;
      const age = Date.parse(`${match[1]}T00:00:00Z`);
      if (Number.isFinite(age) && age < cutoff) {
        await rm(file, { force: true });
        this.offsets.delete(file);
        this.handles.get(file)?.close().catch(() => undefined);
        this.handles.delete(file);
        this.logger?.info(`pruned old spool file ${name}`);
      }
    }
  }

  private async files(): Promise<string[]> {
    try {
      const entries = await readdir(this.spoolDir);
      return entries
        .filter((name) => SPOOL_FILE.test(name))
        .map((name) => path.join(this.spoolDir, name));
    } catch {
      return [];
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.lastPruneDay) {
      this.lastPruneDay = today;
      await this.pruneOldFiles();
    }
    for (const file of await this.files()) {
      await this.pollFile(file);
    }
  }

  private async pollFile(file: string): Promise<void> {
    if (this.disposed || !existsSync(file)) return;
    try {
      const size = (await stat(file)).size;
      const offset = this.offsets.get(file) ?? 0;
      if (size <= offset) return;

      let handle = this.handles.get(file);
      if (!handle) {
        handle = await open(file, 'r');
        this.handles.set(file, handle);
      }
      const length = size - offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const chunk = buffer.toString('utf8');
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline < 0) return;
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
    } catch (error) {
      this.logger?.warn(`spool read failed for ${file}: ${String(error)}`);
    }
  }
}
