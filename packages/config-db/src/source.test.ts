import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createSourceConfigRepo } from './source.js';

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
    expect(createSourceConfigRepo(db, 1).getGithub()).toBeNull();
  });

  it('round-trips github config (no token — token lives in oauth_connection)', () => {
    const repo = createSourceConfigRepo(db, 1);
    repo.putGithub({
      enabled: true,
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: true, botWhitelist: [] },
    });
    const got = repo.getGithub();
    expect(got?.enabled).toBe(true);
    expect(got?.repos).toEqual(['org/a']);
    expect(got?.rules.mentioned).toBe(true);
  });

  it('merges repos on a subsequent put without losing rules/filters', () => {
    const repo = createSourceConfigRepo(db, 1);
    repo.putGithub({
      enabled: true,
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: false, botWhitelist: ['dependabot'] },
    });
    repo.putGithub({ repos: ['org/b'] });
    const got = repo.getGithub();
    expect(got?.repos).toEqual(['org/b']);
    expect(got?.filters).toEqual({ excludeBots: false, botWhitelist: ['dependabot'] });
  });

  it('stores no token columns for github', () => {
    const repo = createSourceConfigRepo(db, 1);
    repo.putGithub({
      repos: ['org/a'],
      rules: fullRules,
      filters: { excludeBots: true, botWhitelist: [] },
    });
    const raw = db
      .prepare('SELECT token_ciphertext, token_nonce FROM source_config WHERE source = ?')
      .get('github') as { token_ciphertext: string | null; token_nonce: string | null };
    expect(raw.token_ciphertext).toBeNull();
    expect(raw.token_nonce).toBeNull();
  });
});
