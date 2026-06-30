import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deriveMasterKey, encryptSecret, decryptSecret } from './secrets.js';

describe('secrets', () => {
  it('encrypts and decrypts with the same key', async () => {
    const salt = randomBytes(16);
    const key = await deriveMasterKey('passphrase', salt);
    const { ciphertext, nonce } = encryptSecret('hello', key);
    expect(decryptSecret(ciphertext, nonce, key)).toBe('hello');
  });
  it('fails to decrypt with a different key', async () => {
    const salt = randomBytes(16);
    const k1 = await deriveMasterKey('a', salt);
    const k2 = await deriveMasterKey('b', salt);
    const { ciphertext, nonce } = encryptSecret('hello', k1);
    expect(() => decryptSecret(ciphertext, nonce, k2)).toThrow();
  });
  it('produces a different nonce each call', () => {
    const key = randomBytes(32);
    const a = encryptSecret('x', key);
    const b = encryptSecret('x', key);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
