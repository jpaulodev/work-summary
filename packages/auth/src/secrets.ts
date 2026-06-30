import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export async function deriveMasterKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    raw: true,
    hashLength: 32,
    timeCost: 3,
    memoryCost: 2 ** 16,
    parallelism: 1,
  }) as Promise<Buffer>;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer,
): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

export function decryptSecret(ciphertext: string, nonce: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
