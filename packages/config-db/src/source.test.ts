import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createSourceConfigRepo } from './source.js';

const key = randomBytes(32);

let db: ReturnType<typeof openDatabase>;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

const fullRules = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

describe('sourceConfigRepo', () => {
  it('returns null when no config', () => {
    expect(createSourceConfigRepo(db, key).getGithub()).toBeNull();
  });

  it('round-trips github config with encrypted token', () => {
    const repo = createSourceConfigRepo(db, key);
    repo.putGithub({
      enabled: true,
      token: 'ghp_xxx',
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: true, botWhitelist: [] },
    });
    const got = repo.getGithub();
    expect(got?.token).toBe('ghp_xxx');
    expect(got?.repos).toEqual(['org/a']);
  });

  it('preserves token when put without token field', () => {
    const repo = createSourceConfigRepo(db, key);
    repo.putGithub({
      enabled: true,
      token: 'ghp_xxx',
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: true, botWhitelist: [] },
    });
    repo.putGithub({ repos: ['org/b'] });
    const got = repo.getGithub();
    expect(got?.token).toBe('ghp_xxx');
    expect(got?.repos).toEqual(['org/b']);
  });

  it('does not store the token as plaintext in the DB', () => {
    const repo = createSourceConfigRepo(db, key);
    repo.putGithub({
      token: 'ghp_secret_value',
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: true, botWhitelist: [] },
    });
    const raw = db
      .prepare('SELECT token_ciphertext, config_json FROM source_config WHERE source = ?')
      .get('github') as { token_ciphertext: string; config_json: string };
    expect(raw.token_ciphertext).not.toContain('ghp_secret_value');
    expect(raw.config_json).not.toContain('ghp_secret_value');
  });
});
