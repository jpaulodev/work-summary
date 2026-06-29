import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createRunsRepo } from './runs-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('runsRepo', () => {
  it('startRun returns incrementing ids', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    expect(repo.startRun()).toBe(1);
    expect(repo.startRun()).toBe(2);
  });

  it('finishRun updates status and stats', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    const id = repo.startRun();
    repo.finishRun(id, 'success', {
      commentsFound: 7,
      commentsNotified: 3,
      sourceStats: { 'org/r': { fetched: 12, matched: 7 } },
    });
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.status).toBe('success');
    expect(row.comments_found).toBe(7);
    expect(row.comments_notified).toBe(3);
    expect(JSON.parse(String(row.source_stats))).toEqual({ 'org/r': { fetched: 12, matched: 7 } });
    expect(row.finished_at).not.toBeNull();
  });

  it('finishRun records error message on failed', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    const id = repo.startRun();
    repo.finishRun(id, 'failed', { commentsFound: 0, commentsNotified: 0, errorMessage: 'boom' });
    const row = db.prepare('SELECT error_message FROM runs WHERE id = ?').get(id) as {
      error_message: string;
    };
    expect(row.error_message).toBe('boom');
  });
});
