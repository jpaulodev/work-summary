import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createOAuthConnectionService } from './oauth.js';

const key = randomBytes(32);
let db: ReturnType<typeof openDatabase>;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('oauthConnectionService', () => {
  it('encrypts tokens at rest and decrypts on read', () => {
    const svc = createOAuthConnectionService(db, key);
    svc.save(1, 'github', { accessToken: 'gho_secret', accountLogin: 'octocat' });

    const raw = db
      .prepare('SELECT access_ciphertext FROM oauth_connection WHERE user_id = 1 AND provider = ?')
      .get('github') as { access_ciphertext: string };
    expect(raw.access_ciphertext).not.toContain('gho_secret');

    const tokens = svc.getTokens(1, 'github');
    expect(tokens?.accessToken).toBe('gho_secret');
    expect(tokens?.accountLogin).toBe('octocat');
    expect(tokens?.refreshToken).toBeNull();
  });

  it('view never exposes tokens', () => {
    const svc = createOAuthConnectionService(db, key);
    svc.save(1, 'github', { accessToken: 'gho_secret', accountLogin: 'octocat' });
    const view = svc.getView(1, 'github');
    expect(view).toMatchObject({ accountLogin: 'octocat', provider: 'github' });
    expect(JSON.stringify(view)).not.toContain('gho_secret');
    expect(Object.keys(view ?? {})).not.toContain('accessToken');
  });

  it('round-trips jira refresh token + cloud fields', () => {
    const svc = createOAuthConnectionService(db, key);
    svc.save(1, 'jira', {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: '2026-06-30T01:00:00.000Z',
      cloudId: 'cloud-1',
      siteUrl: 'https://acme.atlassian.net',
    });
    const tokens = svc.getTokens(1, 'jira');
    expect(tokens?.refreshToken).toBe('rt');
    expect(tokens?.cloudId).toBe('cloud-1');
    expect(tokens?.siteUrl).toBe('https://acme.atlassian.net');
  });

  it('deletes a connection', () => {
    const svc = createOAuthConnectionService(db, key);
    svc.save(1, 'github', { accessToken: 'x' });
    svc.delete(1, 'github');
    expect(svc.getTokens(1, 'github')).toBeNull();
    expect(svc.listViews(1)).toEqual([]);
  });
});
