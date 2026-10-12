import type { AgentId } from '../model/types';
import type { AgentAdapter, CommandMatch } from './AgentAdapter';
import { createClaudeAdapter, type ClaudeAdapterOptions } from './claude';
import { createPiAdapter, type PiAdapterOptions } from './pi';

export interface AgentConfig {
  enabled?: boolean;
  sessionRoot?: string;
  sessionDir?: string;
  patterns?: readonly string[];
}

export interface AgentRegistryOptions {
  env?: NodeJS.ProcessEnv;
  agents?: Partial<Record<AgentId, AgentConfig>>;
}

/**
 * The single place adapters are looked up. Adding a harness means writing one
 * adapter file and adding one `register(...)` line here; nothing else changes.
 */
export class AgentRegistry {
  private readonly adapters = new Map<AgentId, AgentAdapter>();

  register(adapter: AgentAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(id: AgentId): AgentAdapter | undefined {
    return this.adapters.get(id);
  }

  has(id: AgentId): boolean {
    return this.adapters.has(id);
  }

  all(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  ids(): AgentId[] {
    return [...this.adapters.keys()];
  }

  /** Directories all registered adapters want watched. */
  sessionRoots(): string[] {
    return this.all().flatMap((adapter) => adapter.sessionRoots());
  }

  /** The adapter whose patterns match the first token, if any. */
  matchCommand(argv: string[]): AgentAdapter | undefined {
    for (const adapter of this.all()) {
      if (adapter.matchCommand(argv)) return adapter;
    }
    return undefined;
  }

  /** The adapter and match result for a command line, if any. */
  resolveCommand(argv: string[]): { adapter: AgentAdapter; match: CommandMatch } | undefined {
    for (const adapter of this.all()) {
      const match = adapter.matchCommand(argv);
      if (match) return { adapter, match };
    }
    return undefined;
  }
}

export function createDefaultRegistry(options: AgentRegistryOptions = {}): AgentRegistry {
  const claudeConfig = options.agents?.claude;
  const piConfig = options.agents?.pi;

  const claudeOptions: ClaudeAdapterOptions = {};
  if (options.env) claudeOptions.env = options.env;
  if (claudeConfig?.sessionRoot) claudeOptions.sessionRoot = claudeConfig.sessionRoot;
  if (claudeConfig?.patterns) claudeOptions.patterns = claudeConfig.patterns;

  const piOptions: PiAdapterOptions = {};
  if (options.env) piOptions.env = options.env;
  if (piConfig?.sessionRoot) piOptions.sessionRoot = piConfig.sessionRoot;
  if (piConfig?.sessionDir) piOptions.sessionDir = piConfig.sessionDir;
  if (piConfig?.patterns) piOptions.patterns = piConfig.patterns;

  const registry = new AgentRegistry();
  // Harnesses are enabled by default unless a config explicitly disables them.
  if (claudeConfig?.enabled !== false) registry.register(createClaudeAdapter(claudeOptions));
  if (piConfig?.enabled !== false) registry.register(createPiAdapter(piOptions));
  return registry;
}
