import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createCommentsRepo } from './comments-repo.js';
import type { PendingComment } from '@work-summary/core';
import type { SqliteDatabase } from './db.js';

function mkComment(id: string): PendingComment {
  return {
    id,
    source: 'github',
    repo: 'org/r',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: '',
    containerUrl: '',
    commentId: id,
    commentUrl: '',
    author: { login: 'alice', isBot: false },
    body: 'hi',
    createdAt: '2026-06-01T00:00:00Z',
    matchedRules: ['mentioned'],
  };
}

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('commentsRepo', () => {
  it('filterUnnotified returns all when DB empty', () => {
    const repo = createCommentsRepo(db);
    const input = [mkComment('a'), mkComment('b')];
    expect(
      repo
        .filterUnnotified(input)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('markAsNotified persists ids, filterUnnotified skips them', () => {
    const repo = createCommentsRepo(db);
    repo.markAsNotified([mkComment('a')], '2026-06-01T00:00:00Z');
    const input = [mkComment('a'), mkComment('b')];
    expect(repo.filterUnnotified(input).map((c) => c.id)).toEqual(['b']);
  });

  it('markAsNotified is idempotent (re-marking same id does not throw)', () => {
    const repo = createCommentsRepo(db);
    repo.markAsNotified([mkComment('a')], '2026-06-01T00:00:00Z');
    repo.markAsNotified([mkComment('a')], '2026-06-02T00:00:00Z');
    const input = [mkComment('a')];
    expect(repo.filterUnnotified(input)).toEqual([]);
  });

  it('handles empty input arrays', () => {
    const repo = createCommentsRepo(db);
    expect(repo.filterUnnotified([])).toEqual([]);
    expect(() => repo.markAsNotified([], '2026-06-01T00:00:00Z')).not.toThrow();
  });
});
