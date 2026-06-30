import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signSessionId, verifySessionId } from './session.js';

describe('session signer', () => {
  it('round-trips a valid token', () => {
    const secret = randomBytes(32);
    const t = signSessionId('abc123', secret);
    expect(verifySessionId(t, secret)).toBe('abc123');
  });
  it('rejects a tampered token', () => {
    const secret = randomBytes(32);
    const t = signSessionId('abc123', secret);
    expect(verifySessionId(t.slice(0, -1) + 'X', secret)).toBeNull();
  });
  it('rejects a token signed by a different secret', () => {
    const t = signSessionId('abc', randomBytes(32));
    expect(verifySessionId(t, randomBytes(32))).toBeNull();
  });
});
