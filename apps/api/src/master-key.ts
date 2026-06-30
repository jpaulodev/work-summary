import { randomBytes } from 'node:crypto';
import { deriveMasterKey, hashPassword, verifyPassword } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

export async function bootstrapMasterSecret(
  db: SqliteDatabase,
  passphrase: string,
): Promise<Buffer> {
  const salt = randomBytes(16);
  const verifier = await hashPassword(passphrase);
  db.prepare('INSERT INTO master_secret (id, salt, verifier) VALUES (1, ?, ?)').run(
    salt.toString('base64'),
    verifier,
  );
  return deriveMasterKey(passphrase, salt);
}

export async function loadMasterKey(db: SqliteDatabase, passphrase: string): Promise<Buffer> {
  const row = db.prepare('SELECT salt, verifier FROM master_secret WHERE id = 1').get() as
    { salt: string; verifier: string } | undefined;
  if (!row) throw new Error('Master secret not bootstrapped');
  const ok = await verifyPassword(passphrase, row.verifier);
  if (!ok) throw new Error('Invalid master passphrase');
  return deriveMasterKey(passphrase, Buffer.from(row.salt, 'base64'));
}

export function hasMasterSecret(db: SqliteDatabase): boolean {
  return Boolean(db.prepare('SELECT 1 FROM master_secret WHERE id = 1').get());
}
