import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/registry';
import { Correlator } from '../../src/capture/Correlator';
import type { SessionFileEvent } from '../../src/capture/events';
import type { PendingLaunch } from '../../src/model/types';
import { SessionStore } from '../../src/store/SessionStore';
import { createStubAdapter } from './helpers/stubAdapter';

const START = Date.parse('2026-01-02T03:00:00.000Z');
let clock = START;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  clock = START;
});

function iso(): string {
  return new Date(clock).toISOString();
}

async function setup() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'ask-correlator-'));
  const store = new SessionStore({ rootDir });
  await store.init();
  const registry = new AgentRegistry().register(createStubAdapter('claude'));
  const correlator = new Correlator({
    store,
    registry,
    machine: 'test-machine',
    windowSessionId: 'window-1',
    now: () => clock,
  });
  cleanups.push(async () => {
    await store.dispose();
    await rm(rootDir, { recursive: true, force: true });
  });
  return { store, correlator };
}

function launch(overrides: Partial<PendingLaunch> = {}): PendingLaunch {
  return {
    terminalKey: 't1',
    agent: 'claude',
    cwd: '/p/api',
    commandLine: 'claude',
    startedAt: iso(),
    isResume: false,
    via: 'shell-integration',
    ...overrides,
  };
}

function fileEvent(overrides: Partial<SessionFileEvent> = {}): SessionFileEvent {
  return {
    agent: 'claude',
    filePath: '/tmp/s1.jsonl',
    info: { sessionId: 's1', cwd: '/p/api', firstPrompt: 'add health check' },
    createdAtMs: clock,
    modifiedAtMs: clock,
    isNew: true,
    ...overrides,
  };
}

describe('Correlator', () => {
  it('binds a launch to a session file that appears right after it', async () => {
    const { correlator } = await setup();
    expect(await correlator.onLaunch(launch())).toBeUndefined();
    expect(correlator.pendingLaunches()).toHaveLength(1);

    clock += 500;
    const record = await correlator.onSessionFile(fileEvent());

    expect(record).toMatchObject({
      agent: 'claude',
      sessionId: 's1',
      status: 'running',
      bindingConfidence: 'high',
      title: 'add health check',
      titleSource: 'firstPrompt',
    });
    expect(correlator.terminalSessionKey('t1')).toBe('claude/s1');
    expect(correlator.pendingLaunches()).toHaveLength(0);
  });

  it('binds immediately when the launch names a session id', async () => {
    const { correlator } = await setup();
    const record = await correlator.onLaunch(launch({ explicitSessionId: 'preset-1' }));
    expect(record).toMatchObject({
      sessionId: 'preset-1',
      status: 'running',
      bindingConfidence: 'exact',
    });
    expect(correlator.pendingLaunches()).toHaveLength(0);
  });

  it('uses a name from the launcher over the first prompt', async () => {
    const { correlator } = await setup();
    await correlator.onLaunch(launch({ name: 'Renamed session' }));
    const record = await correlator.onSessionFile(fileEvent());
    expect(record).toMatchObject({ title: 'Renamed session', titleSource: 'agent' });
  });

  it('links a /clear session to the session it replaced', async () => {
    const { correlator } = await setup();
    await correlator.onLaunch(launch());
    clock += 500;
    await correlator.onSessionFile(fileEvent({ info: { sessionId: 's1', cwd: '/p/api' } }));

    clock += 1000;
    const second = await correlator.onSessionFile(
      fileEvent({
        filePath: '/tmp/s2.jsonl',
        info: { sessionId: 's2', cwd: '/p/api' },
      }),
    );

    expect(second).toMatchObject({ sessionId: 's2', parentSessionId: 's1', status: 'running' });
    expect(correlator.terminalSessionKey('t1')).toBe('claude/s2');
  });

  it('binds the oldest of two launches in one folder first', async () => {
    const { correlator } = await setup();
    await correlator.onLaunch(launch({ terminalKey: 't1' }));
    clock += 100;
    await correlator.onLaunch(launch({ terminalKey: 't2' }));
    clock += 100;

    const first = await correlator.onSessionFile(fileEvent({ info: { sessionId: 's1', cwd: '/p/api' } }));
    const second = await correlator.onSessionFile(
      fileEvent({ filePath: '/tmp/s2.jsonl', info: { sessionId: 's2', cwd: '/p/api' } }),
    );

    expect(first?.sessionId).toBe('s1');
    expect(second?.sessionId).toBe('s2');
    expect(correlator.terminalSessionKey('t1')).toBe('claude/s1');
    expect(correlator.terminalSessionKey('t2')).toBe('claude/s2');
  });

  it('marks a session exited when the agent ends and closed when the terminal closes', async () => {
    const { store, correlator } = await setup();
    await correlator.onLaunch(launch());
    clock += 500;
    await correlator.onSessionFile(fileEvent());

    await correlator.onTerminalEnded('t1');
    expect(store.get('claude', 's1')?.status).toBe('exited');

    await correlator.onTerminalClosed('t1');
    expect(store.get('claude', 's1')?.status).toBe('closed');
  });

  it('updates last-active when an existing transcript changes', async () => {
    const { store, correlator } = await setup();
    await correlator.onLaunch(launch());
    clock += 500;
    const first = await correlator.onSessionFile(fileEvent());

    clock += 60_000;
    await correlator.onSessionFile(
      fileEvent({ isNew: false, modifiedAtMs: clock, info: { sessionId: 's1', cwd: '/p/api' } }),
    );

    const updated = store.get('claude', 's1');
    expect(Date.parse(updated?.lastActiveAt ?? '')).toBeGreaterThanOrEqual(Date.parse(first?.lastActiveAt ?? ''));
    expect(updated?.lastActiveAt).toBe(new Date(clock).toISOString());
  });

  it('records a session that appears with no matching launch', async () => {
    const { correlator } = await setup();
    const record = await correlator.onSessionFile(
      fileEvent({ info: { sessionId: 'observed', cwd: '/p/other' } }),
    );
    expect(record).toMatchObject({ sessionId: 'observed', status: 'running', bindingConfidence: 'low' });
    expect(record?.launch.via).toBe('import');
  });

  it('drops launches that were never bound', async () => {
    const { correlator } = await setup();
    await correlator.onLaunch(launch());
    clock += 11 * 60 * 1000;
    await correlator.onLaunch(launch({ terminalKey: 't2' }));
    expect(correlator.pendingLaunches()).toHaveLength(1);
  });

  it('binds exactly from a hook event and links a /clear switch', async () => {
    const { correlator } = await setup();
    await correlator.onLaunch(launch());
    clock += 500;

    const first = await correlator.onHookEvent({
      agent: 'claude',
      event: 'SessionStart',
      session_id: 's1',
      cwd: '/p/api',
      transcript_path: '/tmp/s1.jsonl',
      ts: iso(),
    });
    expect(first).toMatchObject({
      sessionId: 's1',
      status: 'running',
      bindingConfidence: 'exact',
      launch: { via: 'hook' },
    });
    expect(correlator.terminalSessionKey('t1')).toBe('claude/s1');

    clock += 1000;
    const second = await correlator.onHookEvent({
      agent: 'claude',
      event: 'SessionStart',
      source: 'clear',
      session_id: 's2',
      cwd: '/p/api',
      transcript_path: '/tmp/s2.jsonl',
      terminalId: 'claude/s1',
      ts: iso(),
    });
    expect(second).toMatchObject({ sessionId: 's2', parentSessionId: 's1' });
  });
});
