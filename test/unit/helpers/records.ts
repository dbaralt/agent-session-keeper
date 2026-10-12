import type { SessionRecord } from '../../../src/model/types';

/** A minimal valid record; override only what a test cares about. */
export function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = new Date().toISOString();
  const base: SessionRecord = {
    schemaVersion: 1,
    agent: 'claude',
    sessionId: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Test session',
    titleSource: 'fallback',
    cwd: '/tmp/project',
    createdAt: now,
    lastActiveAt: now,
    status: 'running',
    bindingConfidence: 'high',
    launch: { commandLine: 'claude', via: 'shell-integration' },
    machine: 'test-host',
    updatedAt: now,
  };
  return {
    ...base,
    ...overrides,
    launch: { ...base.launch, ...overrides.launch },
  };
}
