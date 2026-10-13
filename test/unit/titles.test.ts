import { describe, expect, it } from 'vitest';
import { fallbackTitle, uniquifyTitle } from '../../src/model/titles';
import { makeRecord } from './helpers/records';

describe('fallbackTitle', () => {
  it('combines agent, folder and time', () => {
    expect(fallbackTitle('pi', '/Users/me/code/api', new Date('2026-01-02T14:05:00Z'))).toBe(
      'pi · api · 14:05',
    );
  });

  it('handles an empty cwd', () => {
    expect(fallbackTitle('pi', '', new Date('2026-01-02T14:05:00Z'))).toBe('pi · unknown · 14:05');
  });
});

describe('uniquifyTitle', () => {
  it('returns the desired title when it is unused', () => {
    const records = [makeRecord({ sessionId: 'a', title: 'Alpha' })];
    expect(uniquifyTitle('Beta', records)).toBe('Beta');
  });

  it('appends a number when the title is taken', () => {
    const records = [makeRecord({ sessionId: 'a', title: 'Alpha' })];
    expect(uniquifyTitle('Alpha', records)).toBe('Alpha (2)');
  });

  it('keeps incrementing until it finds a free name', () => {
    const records = [
      makeRecord({ sessionId: 'a', title: 'Alpha' }),
      makeRecord({ sessionId: 'b', title: 'Alpha (2)' }),
    ];
    expect(uniquifyTitle('Alpha', records)).toBe('Alpha (3)');
  });

  it('ignores the record being renamed and archived records', () => {
    const records = [
      makeRecord({ sessionId: 'a', title: 'Alpha' }),
      makeRecord({ sessionId: 'b', title: 'Alpha', status: 'archived' }),
    ];
    expect(uniquifyTitle('Alpha', records, 'claude/a')).toBe('Alpha');
  });
});
