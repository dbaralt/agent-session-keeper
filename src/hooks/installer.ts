import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../store/atomicWrite';
import { withFileLock } from '../store/lock';
import { expandHome, homeDir } from '../util/paths';

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop'] as const;
const PI_EXTENSION_FILENAME = 'agent-session-keeper.ts';
const BACKUP_SUFFIX = '.agent-sessions.bak';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON stringify with object keys sorted, for semantic comparison. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hookMatches(hook: unknown, hookJsPath: string): boolean {
  if (!isObject(hook)) return false;
  if (Array.isArray(hook.args) && hook.args.includes(hookJsPath)) return true;
  // Legacy bare-path form installed by 0.0.1–0.0.3.
  return typeof hook.command === 'string' && hook.command.includes(hookJsPath);
}

function groupHasCommand(group: unknown, hookJsPath: string): boolean {
  if (!isObject(group) || !Array.isArray(group.hooks)) return false;
  return group.hooks.some((hook) => hookMatches(hook, hookJsPath));
}

export function addClaudeHooks(settings: Json, hookJsPath: string, spoolDir: string): void {
  // Exec form: Claude runs `node <args>` directly, with no shell string to quote.
  const entry = {
    type: 'command',
    command: 'node',
    args: [hookJsPath, 'claude', '--spool', spoolDir],
  };
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  for (const event of HOOK_EVENTS) {
    const list = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    if (!list.some((group) => groupHasCommand(group, hookJsPath))) {
      list.push({ matcher: '', hooks: [entry] });
    }
    hooks[event] = list;
  }
  settings.hooks = hooks;
}

export function removeClaudeHooks(settings: Json, hookJsPath: string): void {
  if (!isObject(settings.hooks)) return;
  const hooks = settings.hooks;
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    const list = (hooks[event] as unknown[]).filter((group) => !groupHasCommand(group, hookJsPath));
    if (list.length > 0) hooks[event] = list;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
}

export function hasClaudeHooks(settings: Json, hookJsPath: string): boolean {
  if (!isObject(settings.hooks)) return false;
  return HOOK_EVENTS.every((event) => {
    const list = hooks_event(settings, event);
    return list.some((group) => groupHasCommand(group, hookJsPath));
  });
}

function hooks_event(settings: Json, event: string): unknown[] {
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  return Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
}

export interface HooksInstallerOptions {
  storageDir: string;
  /** Absolute path to resources/hook.js. */
  hookSourcePath: string;
  /** Absolute path to resources/pi-extension.ts. */
  piExtensionSourcePath: string;
  env?: NodeJS.ProcessEnv;
  claudeConfigDir?: string;
  piAgentDir?: string;
  logger?: { info(message: string): void; warn(message: string): void };
}

/** Installs and removes the opt-in exact-capture hooks. */
export class HooksInstaller {
  private readonly storageDir: string;
  private readonly hookSourcePath: string;
  private readonly piExtensionSourcePath: string;
  private readonly claudeConfigDir: string;
  private readonly piAgentDir: string;
  private readonly logger: HooksInstallerOptions['logger'];

  constructor(options: HooksInstallerOptions) {
    const env = options.env ?? process.env;
    const home = homeDir(env);
    this.storageDir = options.storageDir;
    this.hookSourcePath = options.hookSourcePath;
    this.piExtensionSourcePath = options.piExtensionSourcePath;
    this.logger = options.logger;
    this.claudeConfigDir = options.claudeConfigDir
      ? expandHome(options.claudeConfigDir, home)
      : env.CLAUDE_CONFIG_DIR?.trim()
        ? expandHome(env.CLAUDE_CONFIG_DIR, home)
        : path.join(home, '.claude');
    this.piAgentDir = options.piAgentDir
      ? expandHome(options.piAgentDir, home)
      : env.PI_CODING_AGENT_DIR?.trim()
        ? expandHome(env.PI_CODING_AGENT_DIR, home)
        : path.join(home, '.pi', 'agent');
  }

  get spoolDir(): string {
    return path.join(this.storageDir, 'spool');
  }

  get hookJsPath(): string {
    return path.join(this.storageDir, 'bin', 'hook.js');
  }

  get piExtensionPath(): string {
    return path.join(this.piAgentDir, 'extensions', PI_EXTENSION_FILENAME);
  }

  private get settingsPath(): string {
    return path.join(this.claudeConfigDir, 'settings.json');
  }

  async install(): Promise<void> {
    await mkdir(path.dirname(this.hookJsPath), { recursive: true, mode: 0o700 });
    await copyFile(this.hookSourcePath, this.hookJsPath);
    await chmod(this.hookJsPath, 0o755);
    // The storage dir may predate this version; make it owner-only.
    await chmod(this.storageDir, 0o700).catch(() => undefined);
    await this.installClaudeHooks();
    await this.installPiExtension();
    this.logger?.info('installed agent hooks');
  }

  async uninstall(): Promise<void> {
    await this.uninstallClaudeHooks();
    await rm(this.piExtensionPath, { force: true });
    this.logger?.info('removed agent hooks');
  }

  async status(): Promise<{ claude: boolean; pi: boolean }> {
    return { claude: await this.claudeInstalled(), pi: existsSync(this.piExtensionPath) };
  }

  private async claudeInstalled(): Promise<boolean> {
    if (!existsSync(this.settingsPath)) return false;
    try {
      const settings = JSON.parse(await readFile(this.settingsPath, 'utf8')) as Json;
      return hasClaudeHooks(settings, this.hookJsPath);
    } catch {
      return false;
    }
  }

  private async installClaudeHooks(): Promise<void> {
    const settingsPath = this.settingsPath;
    await withFileLock(`${settingsPath}.lock`, async () => {
      const backupPath = `${settingsPath}${BACKUP_SUFFIX}`;
      let original: string | undefined;
      if (existsSync(settingsPath)) {
        original = await readFile(settingsPath, 'utf8');
        if (!existsSync(backupPath)) await writeFileAtomic(backupPath, original);
      }
      const settings = original ? (JSON.parse(original) as Json) : {};
      addClaudeHooks(settings, this.hookJsPath, this.spoolDir);
      await writeJsonAtomic(settingsPath, settings);
    });
  }

  private async uninstallClaudeHooks(): Promise<void> {
    if (!existsSync(this.settingsPath)) return;
    const settingsPath = this.settingsPath;
    await withFileLock(`${settingsPath}.lock`, async () => {
      const backupPath = `${settingsPath}${BACKUP_SUFFIX}`;
      const current = await readFile(settingsPath, 'utf8');
      const settings = JSON.parse(current) as Json;
      removeClaudeHooks(settings, this.hookJsPath);

      if (existsSync(backupPath)) {
        const backup = await readFile(backupPath, 'utf8');
        // If removing our entries restores the original content, restore its exact
        // bytes so install + uninstall is byte-identical.
        if (stableStringify(settings) === stableStringify(JSON.parse(backup))) {
          await writeFileAtomic(settingsPath, backup);
        } else {
          await writeJsonAtomic(settingsPath, settings);
        }
        await rm(backupPath, { force: true });
        return;
      }

      if (Object.keys(settings).length === 0) {
        await rm(settingsPath, { force: true });
      } else {
        await writeJsonAtomic(settingsPath, settings);
      }
    });
  }

  private async installPiExtension(): Promise<void> {
    await mkdir(path.dirname(this.piExtensionPath), { recursive: true, mode: 0o700 });
    const source = await readFile(this.piExtensionSourcePath, 'utf8');
    const templated = source.replaceAll(
      '"__AGENT_SESSIONS_SPOOL_DIR__"',
      JSON.stringify(this.spoolDir),
    );
    await writeFileAtomic(this.piExtensionPath, templated, { mode: 0o644 });
  }
}
