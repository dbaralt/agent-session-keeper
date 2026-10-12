import { describe, expect, it } from 'vitest';
import { activationMessage } from '../../src/util/activation';

describe('activationMessage', () => {
  it('names the extension and the version', () => {
    expect(activationMessage('0.0.1')).toBe('Agent Session Keeper 0.0.1 activated');
  });
});
