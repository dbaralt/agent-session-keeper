/**
 * The persisted data model. Everything the extension keeps on disk is one of
 * these records; nothing agent-specific lives here.
 */

/**
 * A harness id. Kept as a plain string so adding a harness later is one adapter
 * file plus one registry entry, with no change to the model or storage.
 */
export type AgentId = string;

export const SESSION_STATUSES = [
  'pending',
  'running',
  'exited',
  'closed',
  'interrupted',
  'missing',
  'archived',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const TITLE_SOURCES = ['user', 'agent', 'firstPrompt', 'fallback'] as const;
export type TitleSource = (typeof TITLE_SOURCES)[number];

export const BINDING_CONFIDENCES = ['exact', 'high', 'low'] as const;
export type BindingConfidence = (typeof BINDING_CONFIDENCES)[number];

export const LAUNCH_VIAS = ['shell-integration', 'launcher', 'hook', 'import'] as const;
export type LaunchVia = (typeof LAUNCH_VIAS)[number];

export const SESSION_SCHEMA_VERSION = 1 as const;

export interface SessionLaunch {
  commandLine: string;
  via: LaunchVia;
  terminalName?: string;
  shellPid?: number;
  /** vscode.env.sessionId of the window that owns a live session. */
  windowSessionId?: string;
}

export interface SessionRecord {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  agent: AgentId;
  sessionId: string;
  title: string;
  titleSource: TitleSource;
  cwd: string;
  workspaceFolder?: string;
  workspaceName?: string;
  gitBranch?: string;
  /** ISO 8601, first seen. */
  createdAt: string;
  /** Transcript mtime or the latest hook event. */
  lastActiveAt: string;
  lastResumedAt?: string;
  status: SessionStatus;
  bindingConfidence: BindingConfidence;
  launch: SessionLaunch;
  transcriptPath?: string;
  /** Set after /clear, /new, /fork or /branch. */
  parentSessionId?: string;
  pinned?: boolean;
  notes?: string;
  machine: string;
  updatedAt: string;
}

/** A launch seen in a terminal that has not been bound to a session file yet. */
export interface PendingLaunch {
  terminalKey: string;
  agent: AgentId;
  cwd: string;
  commandLine: string;
  startedAt: string;
  shellPid?: number;
  explicitSessionId?: string;
  isResume: boolean;
  name?: string;
}

/** What an adapter can read from the envelope of a session file. */
export interface SessionFileInfo {
  sessionId: string;
  cwd?: string;
  startedAt?: string;
  name?: string;
  firstPrompt?: string;
  gitBranch?: string;
}

/** Stable identity of a record: one file per `${agent}/${sessionId}`. */
export function sessionKey(agent: AgentId, sessionId: string): string {
  return `${agent}/${sessionId}`;
}

export function parseSessionKey(key: string): { agent: AgentId; sessionId: string } | undefined {
  const slash = key.indexOf('/');
  if (slash <= 0) return undefined;
  const agent = key.slice(0, slash);
  const sessionId = key.slice(slash + 1);
  if (!isAgentId(agent) || sessionId.length === 0) return undefined;
  return { agent, sessionId };
}

export function isAgentId(value: unknown): value is AgentId {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('/') &&
    !value.startsWith('.')
  );
}

function isStringArrayOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Structural check for data read from disk. Tolerant of unknown extra keys. */
export function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isAgentId(v.agent) &&
    typeof v.sessionId === 'string' &&
    v.sessionId.length > 0 &&
    typeof v.title === 'string' &&
    isStringArrayOf(v.titleSource, TITLE_SOURCES) &&
    typeof v.cwd === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.lastActiveAt === 'string' &&
    isStringArrayOf(v.status, SESSION_STATUSES) &&
    isStringArrayOf(v.bindingConfidence, BINDING_CONFIDENCES) &&
    typeof v.launch === 'object' &&
    v.launch !== null &&
    typeof v.machine === 'string' &&
    typeof v.updatedAt === 'string'
  );
}

function copyOptional<T, K extends keyof T>(target: T, source: T, keys: readonly K[]): void {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

/** Returns a clean record with only defined optional fields and a fixed schema version. */
export function normalizeRecord(record: SessionRecord): SessionRecord {
  const out: SessionRecord = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    agent: record.agent,
    sessionId: record.sessionId,
    title: record.title,
    titleSource: record.titleSource,
    cwd: record.cwd,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    status: record.status,
    bindingConfidence: record.bindingConfidence,
    launch: { ...record.launch },
    machine: record.machine,
    updatedAt: record.updatedAt,
  };
  copyOptional(out, record, [
    'workspaceFolder',
    'workspaceName',
    'gitBranch',
    'lastResumedAt',
    'transcriptPath',
    'parentSessionId',
    'notes',
  ]);
  if (record.pinned !== undefined) out.pinned = record.pinned;
  copyOptional(out.launch, record.launch, ['terminalName', 'shellPid', 'windowSessionId']);
  return out;
}

/**
 * Field-level merge for two versions of one record. The newer `updatedAt` wins
 * for any field both sides define; fields only one side has are kept. This is
 * what stops two windows from erasing each other's edits.
 */
export function mergeSessionRecords(
  existing: SessionRecord | undefined,
  incoming: SessionRecord,
): SessionRecord {
  if (!existing) return normalizeRecord(incoming);
  const incomingNewer = incoming.updatedAt >= existing.updatedAt;
  const newer = incomingNewer ? incoming : existing;
  const older = incomingNewer ? existing : incoming;
  const merged = normalizeRecord({ ...older, ...newer });
  merged.launch = { ...older.launch, ...newer.launch };
  return merged;
}
