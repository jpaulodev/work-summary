import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import { loadConfigFromDb, hasDbConfig } from './config-db-loader.js';

const key = randomBytes(32);

describe('loadConfigFromDb', () => {
  it('reconstructs the Phase 1 Config shape from encrypted DB rows', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);

    expect(hasDbConfig(db)).toBe(false);

    createSourceConfigRepo(db, key).putGithub({
      enabled: true,
      token: 'ghp_db_token',
      repos: ['org/a', 'org/b'],
      rules: {
        authorOfPrUnanswered: true,
        mentioned: true,
        repliedBeforeThenFollowup: false,
        assignee: true,
        changesRequested: true,
      },
      filters: { excludeBots: true, botWhitelist: ['dependabot[bot]'] },
    });
    createNotifierConfigRepo(db, key).put('primary-email', {
      enabled: true,
      host: 'smtp.test',
      port: 587,
      secure: false,
      from: 'a@b',
      to: 'c@d',
      subjectTemplate: '[ws] {{count}}',
      user: 'smtpuser',
      pass: 'smtppass',
    });

    expect(hasDbConfig(db)).toBe(true);

    const cfg = loadConfigFromDb(db, key, 'me');
    expect(cfg.user.githubLogin).toBe('me');
    expect(cfg.sources.github.token).toBe('ghp_db_token');
    expect(cfg.sources.github.repos).toEqual(['org/a', 'org/b']);
    expect(cfg.sources.github.rules.repliedBeforeThenFollowup).toBe(false);
    expect(cfg.notifications[0]?.smtp.user).toBe('smtpuser');
    expect(cfg.notifications[0]?.smtp.pass).toBe('smtppass');
  });
});
