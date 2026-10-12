import type { SessionRecord, SessionStatus } from '../model/types';

export type SessionSortKey = 'lastActive' | 'created' | 'title' | 'agent';

export interface SessionQuery {
  text?: string;
  agents?: string[];
  statuses?: SessionStatus[];
  workspace?: string;
  /** ISO date (inclusive). */
  from?: string;
  /** ISO date (inclusive). */
  to?: string;
  sortBy?: SessionSortKey;
  sortDir?: 'asc' | 'desc';
  includeArchived?: boolean;
}

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Filter and sort records for the history page. Kept pure so it can be tested
 * against hundreds of records for both correctness and speed.
 */
export function filterSessions(
  records: readonly SessionRecord[],
  query: SessionQuery = {},
): SessionRecord[] {
  const text = query.text?.trim().toLowerCase();
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  const agents = query.agents && query.agents.length > 0 ? new Set(query.agents) : undefined;
  const statuses =
    query.statuses && query.statuses.length > 0 ? new Set(query.statuses) : undefined;

  const result: SessionRecord[] = [];
  for (const record of records) {
    if (!query.includeArchived && record.status === 'archived') continue;
    if (agents && !agents.has(record.agent)) continue;
    if (statuses && !statuses.has(record.status)) continue;
    if (query.workspace && record.workspaceFolder !== query.workspace) continue;
    const lastActive = Date.parse(record.lastActiveAt);
    if (from !== undefined && lastActive < from) continue;
    if (to !== undefined && lastActive > to) continue;
    if (text) {
      const haystack = `${record.title} ${record.cwd} ${record.workspaceName ?? ''} ${
        record.gitBranch ?? ''
      } ${record.sessionId}`.toLowerCase();
      if (!haystack.includes(text)) continue;
    }
    result.push(record);
  }

  const direction = query.sortDir === 'asc' ? 1 : -1;
  const sortBy = query.sortBy ?? 'lastActive';
  result.sort((a, b) => {
    let compare: number;
    switch (sortBy) {
      case 'title':
        compare = a.title.localeCompare(b.title);
        break;
      case 'agent':
        compare = a.agent.localeCompare(b.agent) || a.title.localeCompare(b.title);
        break;
      case 'created':
        compare = Date.parse(a.createdAt) - Date.parse(b.createdAt);
        break;
      default:
        compare = Date.parse(a.lastActiveAt) - Date.parse(b.lastActiveAt);
    }
    if (compare === 0) compare = a.sessionId.localeCompare(b.sessionId);
    return compare * direction;
  });
  return result;
}
