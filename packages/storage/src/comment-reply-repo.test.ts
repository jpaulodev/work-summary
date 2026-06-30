import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { CommentReplyRepository } from './comment-reply-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
  db.prepare(
    `INSERT INTO notified_comments
       (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
     VALUES ('c1', 'github', 'org/r', 'pr', 1, 'c1', 'alice', '[]', '2026-06-01T00:00:00Z')`,
  ).run();
});

describe('CommentReplyRepository', () => {
  it('inserts and lists replies ordered by sent_at', () => {
    const repo = new CommentReplyRepository(db, 1);
    repo.insert({
      commentId: 'c1',
      body: 'first',
      sentAt: '2026-06-01T00:00:00Z',
      source: 'github',
      sourceResponseId: '1',
      sourceUrl: 'https://x/1',
    });
    repo.insert({
      commentId: 'c1',
      body: 'second',
      sentAt: '2026-06-02T00:00:00Z',
      source: 'github',
      sourceResponseId: '2',
      sourceUrl: 'https://x/2',
    });
    expect(repo.listByComment('c1').map((r) => r.body)).toEqual(['first', 'second']);
  });

  it('cascade-deletes replies when the comment is removed', () => {
    const repo = new CommentReplyRepository(db, 1);
    repo.insert({
      commentId: 'c1',
      body: 'x',
      sentAt: '2026-06-01T00:00:00Z',
      source: 'github',
      sourceResponseId: null,
      sourceUrl: null,
    });
    db.prepare('DELETE FROM notified_comments WHERE id = ?').run('c1');
    expect(repo.listByComment('c1')).toHaveLength(0);
  });
});
