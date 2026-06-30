import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createWatermarksRepo } from './watermarks-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('watermarksRepo', () => {
  it('get returns null when no watermark exists', () => {
    const r = createWatermarksRepo(db, 1);
    expect(r.get('github', 'org/repo')).toBeNull();
  });

  it('set then get returns the stored timestamp', () => {
    const r = createWatermarksRepo(db, 1);
    r.set('github', 'org/repo', '2026-06-01T00:00:00Z');
    expect(r.get('github', 'org/repo')).toBe('2026-06-01T00:00:00Z');
  });

  it('set upserts (second set overwrites)', () => {
    const r = createWatermarksRepo(db, 1);
    r.set('github', 'org/repo', '2026-06-01T00:00:00Z');
    r.set('github', 'org/repo', '2026-06-02T00:00:00Z');
    expect(r.get('github', 'org/repo')).toBe('2026-06-02T00:00:00Z');
  });

  it('keeps watermarks per (source, repo) independent', () => {
    const r = createWatermarksRepo(db, 1);
    r.set('github', 'org/a', '2026-06-01T00:00:00Z');
    r.set('github', 'org/b', '2026-06-02T00:00:00Z');
    expect(r.get('github', 'org/a')).toBe('2026-06-01T00:00:00Z');
    expect(r.get('github', 'org/b')).toBe('2026-06-02T00:00:00Z');
  });
});
