/**
 * Child-process helper for the store concurrency test. Updates one field of an
 * existing record on disk, waiting until a shared start time so two of these
 * really do race.
 *
 *   node updateField.mjs <rootDir> <agent> <sessionId> <field> <value> <startAtMs>
 */
import type { AgentId, SessionRecord } from '../../../src/model/types';
import { SessionStore } from '../../../src/store/SessionStore';

async function waitUntil(startAt: number): Promise<void> {
  while (Date.now() < startAt) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function main(): Promise<void> {
  const [rootDir, agent, sessionId, field, value, startAtRaw] = process.argv.slice(2);
  if (!rootDir || !agent || !sessionId || !field) {
    throw new Error('usage: updateField <rootDir> <agent> <sessionId> <field> <value> <startAt>');
  }

  await waitUntil(Number(startAtRaw ?? 0));

  const store = new SessionStore({ rootDir });
  try {
    await store.update(agent as AgentId, sessionId, {
      [field]: value,
    } as unknown as Partial<SessionRecord>);
  } finally {
    await store.dispose();
  }
}

await main();
