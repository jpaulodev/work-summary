import { randomBytes } from 'node:crypto';
import { deriveMasterKey, hashPassword, verifyPassword } from '@work-summary/auth';
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';
import { ConfigError, type Config } from './config.js';

/** Create the master_secret row from a passphrase and return the derived key. */
export async function bootstrapMasterKey(db: SqliteDatabase, passphrase: string): Promise<Buffer> {
  const salt = randomBytes(16);
  const verifier = await hashPassword(passphrase);
  db.prepare('INSERT INTO master_secret (id, salt, verifier) VALUES (1, ?, ?)').run(
    salt.toString('base64'),
    verifier,
  );
  return deriveMasterKey(passphrase, salt);
}

/**
 * Derive the AES master key from MASTER_PASSPHRASE, verifying it against the
 * stored master_secret verifier. Returns null if the DB has not been
 * bootstrapped (so callers can fall back to YAML).
 */
export async function loadMasterKey(
  db: SqliteDatabase,
  passphrase: string,
): Promise<Buffer | null> {
  const row = db.prepare('SELECT salt, verifier FROM master_secret WHERE id = 1').get() as
    { salt: string; verifier: string } | undefined;
  if (!row) return null;
  const ok = await verifyPassword(passphrase, row.verifier);
  if (!ok) throw new ConfigError('Invalid MASTER_PASSPHRASE');
  return deriveMasterKey(passphrase, Buffer.from(row.salt, 'base64'));
}

export function hasDbConfig(db: SqliteDatabase): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_config'")
    .get();
  if (!row) return false;
  return Boolean(db.prepare('SELECT 1 FROM source_config WHERE source = ?').get('github'));
}

export function loadConfigFromDb(db: SqliteDatabase, key: Buffer, githubLogin: string): Config {
  const src = createSourceConfigRepo(db, key).getGithub();
  if (!src) throw new ConfigError('No source config in DB');
  const notifs = createNotifierConfigRepo(db, key);
  const notifications = notifs.list().map((n) => {
    const f = notifs.get(n.id);
    if (!f) throw new ConfigError(`notifier ${n.id} missing`);
    return {
      id: n.id,
      type: 'smtp' as const,
      enabled: n.enabled,
      smtp: { host: n.host, port: n.port, secure: n.secure, user: f.user, pass: f.pass },
      from: n.from,
      to: n.to,
      subjectTemplate: n.subjectTemplate,
    };
  });
  if (notifications.length === 0) throw new ConfigError('No notifier config in DB');
  return {
    user: { githubLogin },
    sources: {
      github: { token: src.token, repos: src.repos, rules: src.rules, filters: src.filters },
    },
    scan: { lookbackDays: 7, concurrency: 3 },
    notifications,
    logging: { level: 'info', file: '~/.local/state/work-summary/scan.log' },
  };
}
