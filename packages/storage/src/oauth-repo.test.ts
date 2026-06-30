import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { OAuthConnectionRepository } from './oauth-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
let repo: OAuthConnectionRepository;
const clock = { t: '2026-06-30T00:00:00.000Z' };

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  repo = new OAuthConnectionRepository(db, () => new Date(clock.t));
});

describe('OAuthConnectionRepository', () => {
  it('returns null when no connection exists', () => {
    expect(repo.get(1, 'github')).toBeNull();
    expect(repo.list(1)).toEqual([]);
  });

  it('inserts and reads back a github connection', () => {
    const row = repo.upsert(1, 'github', {
      accessCiphertext: 'ct',
      accessNonce: 'nc',
      accountId: '42',
      accountLogin: 'octocat',
    });
    expect(row.accountLogin).toBe('octocat');
    expect(row.refreshCiphertext).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(repo.get(1, 'github')?.accessCiphertext).toBe('ct');
  });

  it('upsert updates in place and preserves created_at', () => {
    clock.t = '2026-06-30T00:00:00.000Z';
    const first = repo.upsert(1, 'github', { accessCiphertext: 'a', accessNonce: 'n1' });
    clock.t = '2026-07-01T00:00:00.000Z';
    const second = repo.upsert(1, 'github', {
      accessCiphertext: 'b',
      accessNonce: 'n2',
      accountLogin: 'new',
    });
    expect(second.accessCiphertext).toBe('b');
    expect(second.accountLogin).toBe('new');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(repo.list(1)).toHaveLength(1);
  });

  it('isolates connections by user_id', () => {
    repo.upsert(1, 'github', { accessCiphertext: 'u1', accessNonce: 'n' });
    repo.upsert(2, 'github', { accessCiphertext: 'u2', accessNonce: 'n' });
    expect(repo.get(1, 'github')?.accessCiphertext).toBe('u1');
    expect(repo.get(2, 'github')?.accessCiphertext).toBe('u2');
  });

  it('stores jira refresh + cloud fields and deletes', () => {
    repo.upsert(1, 'jira', {
      accessCiphertext: 'a',
      accessNonce: 'n',
      refreshCiphertext: 'r',
      refreshNonce: 'rn',
      expiresAt: '2026-06-30T01:00:00.000Z',
      cloudId: 'cloud-1',
      siteUrl: 'https://acme.atlassian.net',
    });
    const row = repo.get(1, 'jira');
    expect(row?.cloudId).toBe('cloud-1');
    expect(row?.refreshCiphertext).toBe('r');
    repo.delete(1, 'jira');
    expect(repo.get(1, 'jira')).toBeNull();
  });
});
