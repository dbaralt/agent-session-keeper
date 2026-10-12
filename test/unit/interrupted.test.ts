import { describe, expect, it } from 'vitest';
import { detectInterrupted, findLiveTerminal, type LiveTerminal } from '../../src/restore/interrupted';
import { makeRecord } from './helpers/records';

const CURRENT = 'window-current';

function running(overrides: Parameters<typeof makeRecord>[0] = {}) {
  return makeRecord({ status: 'running', ...overrides });
}

describe('detectInterrupted', () => {
  it('marks a foreign running session with no live terminal as interrupted', () => {
    const record = running({
      sessionId: 's1',
      launch: { commandLine: 'claude', via: 'shell-integration', windowSessionId: 'window-old' },
    });
    const result = detectInterrupted([record], CURRENT, []);
    expect(result.interrupted.map((r) => r.sessionId)).toEqual(['s1']);
    expect(result.stillRunning).toEqual([]);
  });

  it('rebinds a foreign session whose shell pid is still alive', () => {
    const record = running({
      sessionId: 's1',
      launch: { commandLine: 'claude', via: 'shell-integration', shellPid: 42, windowSessionId: 'window-old' },
    });
    const live: LiveTerminal[] = [{ key: 't1', shellPid: 42, name: 'zsh' }];
    const result = detectInterrupted([record], CURRENT, live);
    expect(result.interrupted).toEqual([]);
    expect(result.stillRunning.map((r) => r.sessionId)).toEqual(['s1']);
  });

  it('leaves a session owned by the current window alone', () => {
    const record = running({
      sessionId: 's1',
      launch: { commandLine: 'claude', via: 'shell-integration', windowSessionId: CURRENT },
    });
    const result = detectInterrupted([record], CURRENT, []);
    expect(result.interrupted).toEqual([]);
    expect(result.stillRunning).toHaveLength(1);
  });

  it('ignores sessions that are already exited, closed, missing or archived', () => {
    const records = ['exited', 'closed', 'missing', 'archived'].map((status, index) =>
      makeRecord({ sessionId: `s${index}`, status: status as never }),
    );
    const result = detectInterrupted(records, CURRENT, []);
    expect(result.interrupted).toEqual([]);
    expect(result.stillRunning).toEqual([]);
  });

  it('treats pending launches like running ones', () => {
    const record = makeRecord({
      sessionId: 'p1',
      status: 'pending',
      launch: { commandLine: 'claude', via: 'shell-integration', windowSessionId: 'window-old' },
    });
    expect(detectInterrupted([record], CURRENT, []).interrupted).toHaveLength(1);
  });

  it('falls back to the terminal name when there is no pid', () => {
    const record = running({
      sessionId: 's1',
      launch: { commandLine: 'claude', via: 'shell-integration', terminalName: 'claude: api', windowSessionId: 'old' },
    });
    expect(findLiveTerminal(record, [{ key: 'x', name: 'claude: api' }])).toBeDefined();
    expect(findLiveTerminal(record, [{ key: 'x', name: 'other' }])).toBeUndefined();
  });
});
