import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createNotifierConfigRepo } from './notifier.js';

const key = randomBytes(32);

let db: ReturnType<typeof openDatabase>;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

const base = {
  enabled: true,
  host: 'smtp.test',
  port: 587,
  secure: false,
  from: 'a@b',
  to: 'c@d',
  subjectTemplate: '[ws] {{count}}',
  user: 'u',
  pass: 'p',
};

describe('notifierConfigRepo', () => {
  it('list returns items without secrets but with hasSecret', () => {
    const repo = createNotifierConfigRepo(db, key);
    repo.put('primary', base);
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'primary', host: 'smtp.test', hasSecret: true });
    expect(list[0]).not.toHaveProperty('pass');
    expect(list[0]).not.toHaveProperty('user');
  });

  it('get decrypts the secret round-trip', () => {
    const repo = createNotifierConfigRepo(db, key);
    repo.put('primary', base);
    const got = repo.get('primary');
    expect(got?.user).toBe('u');
    expect(got?.pass).toBe('p');
  });

  it('preserves the secret on partial update without user/pass', () => {
    const repo = createNotifierConfigRepo(db, key);
    repo.put('primary', base);
    repo.put('primary', { host: 'smtp.new' });
    const got = repo.get('primary');
    expect(got?.host).toBe('smtp.new');
    expect(got?.pass).toBe('p');
  });

  it('does not store smtp pass as plaintext', () => {
    const repo = createNotifierConfigRepo(db, key);
    repo.put('primary', { ...base, pass: 'super-secret-pass' });
    const raw = db
      .prepare('SELECT secret_ciphertext, config_json FROM notifier_config WHERE id = ?')
      .get('primary') as { secret_ciphertext: string; config_json: string };
    expect(raw.secret_ciphertext).not.toContain('super-secret-pass');
    expect(raw.config_json).not.toContain('super-secret-pass');
  });

  it('delete removes the row', () => {
    const repo = createNotifierConfigRepo(db, key);
    repo.put('primary', base);
    repo.delete('primary');
    expect(repo.list()).toHaveLength(0);
  });
});
