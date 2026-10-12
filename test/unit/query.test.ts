import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../src/model/types';
import { filterSessions } from '../../src/ui/query';
import { makeRecord } from './helpers/records';

function synthetic(count: number): SessionRecord[] {
  const statuses = ['running', 'closed', 'interrupted', 'archived', 'missing'] as const;
  const agents = ['claude', 'pi'];
  return Array.from({ length: count }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, '0');
    return makeRecord({
      agent: agents[index % agents.length] as string,
      sessionId: `session-${index}`,
      title: `Session number ${index} about ${index % 7 === 0 ? 'auth' : 'ui'}`,
      cwd: `/projects/${index % 5}`,
      workspaceFolder: `/projects/${index % 5}`,
      workspaceName: `project-${index % 5}`,
      gitBranch: `branch-${index % 3}`,
      status: statuses[index % statuses.length] as never,
      createdAt: `2026-01-${day}T03:00:00.000Z`,
      lastActiveAt: `2026-01-${day}T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    });
  });
}

describe('filterSessions', () => {
  const records = synthetic(500);

  it('filters 500 records by text, agent and status in well under 100 ms', () => {
    const start = performance.now();
    const result = filterSessions(records, { text: 'auth', agents: ['claude'], statuses: ['running'] });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    for (const record of result) {
      expect(record.title.toLowerCase()).toContain('auth');
      expect(record.agent).toBe('claude');
      expect(record.status).toBe('running');
    }
  });

  it('hides archived records unless asked for them', () => {
    const visible = filterSessions(records, {});
    expect(visible.every((record) => record.status !== 'archived')).toBe(true);
    const archived = filterSessions(records, { statuses: ['archived'], includeArchived: true });
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.every((record) => record.status === 'archived')).toBe(true);
  });

  it('searches folder, branch and session id', () => {
    expect(filterSessions(records, { text: '/projects/3', includeArchived: true }).length).toBeGreaterThan(0);
    expect(
      filterSessions(records, { text: 'branch-2', includeArchived: true }).every(
        (record) => record.gitBranch === 'branch-2',
      ),
    ).toBe(true);
    expect(
      filterSessions(records, { text: 'session-42' }).some(
        (record) => record.sessionId === 'session-42',
      ),
    ).toBe(true);
  });

  it('sorts by last active, newest first by default', () => {
    const sorted = filterSessions(records, {});
    for (let i = 1; i < sorted.length; i += 1) {
      expect(Date.parse(sorted[i - 1]!.lastActiveAt)).toBeGreaterThanOrEqual(
        Date.parse(sorted[i]!.lastActiveAt),
      );
    }
  });

  it('sorts ascending when asked', () => {
    const sorted = filterSessions(records, { sortBy: 'title', sortDir: 'asc' });
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1]!.title.localeCompare(sorted[i]!.title)).toBeLessThanOrEqual(0);
    }
  });

  it('filters by date range', () => {
    const result = filterSessions(records, {
      from: '2026-01-10T00:00:00.000Z',
      to: '2026-01-12T23:59:59.999Z',
    });
    expect(result.length).toBeGreaterThan(0);
    for (const record of result) {
      const time = Date.parse(record.lastActiveAt);
      expect(time).toBeGreaterThanOrEqual(Date.parse('2026-01-10T00:00:00.000Z'));
      expect(time).toBeLessThanOrEqual(Date.parse('2026-01-12T23:59:59.999Z'));
    }
  });

  it('filters by workspace', () => {
    const result = filterSessions(records, { workspace: '/projects/2' });
    expect(result.every((record) => record.workspaceFolder === '/projects/2')).toBe(true);
  });
});
