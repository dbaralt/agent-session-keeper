import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAdapter } from '../agents/AgentAdapter';
import type { AgentRegistry } from '../agents/registry';
import { SESSION_SCHEMA_VERSION, type SessionRecord, type TitleSource } from '../model/types';
import { uniquifyTitle } from '../model/titles';
import type { SessionStore, StoreLogger } from '../store/SessionStore';

export interface ImportExistingOptions {
  store: SessionStore;
  registry: AgentRegistry;
  machine: string;
  windowSessionId: string;
  workspaceFolderFor?: (cwd: string) => { folder?: string; name?: string } | undefined;
  logger?: StoreLogger;
}

async function walk(dir: string, match: (file: string) => boolean, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, match, out);
    else if (match(full)) out.push(full);
  }
}

function chooseTitle(
  adapter: AgentAdapter,
  info: { name?: string; firstPrompt?: string; cwd?: string },
): { title: string; titleSource: TitleSource } {
  if (info.name) return { title: info.name, titleSource: 'agent' };
  if (info.firstPrompt) return { title: info.firstPrompt, titleSource: 'firstPrompt' };
  const folder = info.cwd ? path.basename(info.cwd) : 'unknown';
  return { title: `${adapter.displayName} · ${folder}`, titleSource: 'fallback' };
}

/** Backfill records from session files that already exist on disk. */
export async function importExisting(options: ImportExistingOptions): Promise<number> {
  const { store, registry } = options;
  let imported = 0;

  for (const adapter of registry.all()) {
    for (const root of adapter.sessionRoots()) {
      if (!existsSync(root)) continue;
      const files: string[] = [];
      await walk(root, (file) => adapter.isSessionFile(file), files);

      for (const file of files) {
        let info;
        try {
          info = await adapter.readSessionFile(file);
        } catch (error) {
          options.logger?.warn(`import: could not read ${file}: ${String(error)}`);
          continue;
        }
        if (!info || store.get(adapter.id, info.sessionId)) continue;

        const fileStat = await stat(file);
        const cwd = info.cwd ?? '';
        const workspace = cwd ? options.workspaceFolderFor?.(cwd) : undefined;
        const { title, titleSource } = chooseTitle(adapter, info);
        const uniqueTitle = uniquifyTitle(title, store.all());
        const startedAt = info.startedAt ?? new Date(fileStat.birthtimeMs).toISOString();

        const record: SessionRecord = {
          schemaVersion: SESSION_SCHEMA_VERSION,
          agent: adapter.id,
          sessionId: info.sessionId,
          title: uniqueTitle,
          titleSource,
          cwd,
          createdAt: startedAt,
          lastActiveAt: new Date(fileStat.mtimeMs).toISOString(),
          status: 'closed',
          bindingConfidence: 'low',
          launch: { commandLine: '', via: 'import', windowSessionId: options.windowSessionId },
          transcriptPath: file,
          machine: options.machine,
          updatedAt: new Date().toISOString(),
        };
        if (workspace?.folder) record.workspaceFolder = workspace.folder;
        if (workspace?.name) record.workspaceName = workspace.name;
        if (info.gitBranch) record.gitBranch = info.gitBranch;

        await store.upsert(record);
        imported += 1;
      }
    }
  }

  options.logger?.info(`imported ${imported} existing session(s)`);
  return imported;
}
