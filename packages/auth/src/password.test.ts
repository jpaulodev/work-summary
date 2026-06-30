import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('verifyPassword returns true for the same plaintext', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
  });
  it('verifyPassword returns false for wrong plaintext', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});
