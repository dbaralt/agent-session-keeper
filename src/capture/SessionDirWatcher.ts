import { readdirSync, watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRegistry } from '../agents/registry';
import type { SessionFileEvent } from './events';

export interface SessionDirWatcherLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface SessionDirWatcherOptions {
  registry: AgentRegistry;
  onEvent: (event: SessionFileEvent) => void | Promise<void>;
  logger?: SessionDirWatcherLogger;
  debounceMs?: number;
}

function isUnder(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

/** The nearest ancestor of `dir` (including itself) that exists as a directory. */
async function nearestExistingDir(dir: string): Promise<string | undefined> {
  let current = path.resolve(dir);
  for (;;) {
    try {
      if ((await stat(current)).isDirectory()) return current;
    } catch {
      // Keep walking up.
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

interface WatchedRoot {
  agent: string;
  root: string;
}

/**
 * Watches each adapter's session folders and turns new or changed `.jsonl`
 * files into {@link SessionFileEvent}s. Files already present when watching
 * starts are marked as known, so they are not mistaken for new sessions.
 */
export class SessionDirWatcher {
  private readonly registry: AgentRegistry;
  private readonly onEvent: (event: SessionFileEvent) => void | Promise<void>;
  private readonly logger: SessionDirWatcherLogger | undefined;
  private readonly debounceMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly known = new Set<string>();
  private readonly roots: WatchedRoot[] = [];
  private disposed = false;

  constructor(options: SessionDirWatcherOptions) {
    this.registry = options.registry;
    this.onEvent = options.onEvent;
    this.logger = options.logger;
    this.debounceMs = options.debounceMs ?? 250;
  }

  async start(): Promise<void> {
    for (const adapter of this.registry.all()) {
      for (const root of adapter.sessionRoots()) {
        await this.watchRoot(adapter.id, root);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
  }

  private async watchRoot(agent: string, root: string): Promise<void> {
    const base = await nearestExistingDir(root);
    if (!base) {
      this.logger?.info(`session root not found, skipping: ${root}`);
      return;
    }

    this.preload(root);
    this.roots.push({ agent, root });

    const watcher = watch(base, { recursive: true }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename : undefined;
      if (!name || !name.endsWith('.jsonl')) return;
      const full = path.join(base, name);
      if (!isUnder(full, root)) return;
      this.schedule(full, agent);
    });
    watcher.on('error', (error) => {
      this.logger?.warn(`watcher error for ${root}: ${String(error)}`);
    });
    this.watchers.push(watcher);
    this.logger?.info(
      base === root ? `watching ${agent} sessions in ${root}` : `watching for ${root} via ${base}`,
    );
  }

  private preload(root: string): void {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.jsonl')) this.known.add(full);
      }
    }
  }

  private schedule(filePath: string, agent: string): void {
    if (this.disposed) return;
    const existing = this.timers.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(filePath);
      void this.handle(filePath, agent);
    }, this.debounceMs);
    this.timers.set(filePath, timer);
  }

  private async handle(filePath: string, agent: string): Promise<void> {
    if (this.disposed) return;
    const adapter = this.registry.get(agent);
    if (!adapter || !adapter.isSessionFile(filePath)) return;

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return;
    }

    let info;
    try {
      info = await adapter.readSessionFile(filePath);
    } catch (error) {
      this.logger?.warn(`could not read ${filePath}: ${String(error)}`);
      return;
    }
    if (!info) return;

    const isNew = !this.known.has(filePath);
    this.known.add(filePath);
    const createdAtMs = fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.mtimeMs;

    await this.onEvent({
      agent,
      filePath,
      info,
      createdAtMs,
      modifiedAtMs: fileStat.mtimeMs,
      isNew,
    });
  }
}
