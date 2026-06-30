import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;

function seedComment(id: string, repo: string, author: string, notifiedAt: string): void {
  db.prepare(
    `INSERT INTO notified_comments
       (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
     VALUES (?, 'github', ?, 'pr', 1, ?, ?, ?, ?)`,
  ).run(id, repo, id, author, JSON.stringify(['mentioned']), notifiedAt);
}

beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});

describe('comments routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/comments' });
    expect(res.statusCode).toBe(401);
  });

  it('lists seeded comments newest first with parsed rules', async () => {
    seedComment('a', 'org/a', 'alice', '2026-06-01T10:00:00Z');
    seedComment('b', 'org/a', 'bob', '2026-06-02T10:00:00Z');
    const res = await app.inject({ method: 'GET', url: '/api/comments', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; matchedRules: string[] }> }>();
    expect(body.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(body.items[0]?.matchedRules).toEqual(['mentioned']);
  });

  it('updates status and filters by it', async () => {
    seedComment('a', 'org/a', 'alice', '2026-06-01T10:00:00Z');
    const upd = await app.inject({
      method: 'POST',
      url: '/api/comments/a/status',
      headers: { cookie },
      payload: { status: 'addressed' },
    });
    expect(upd.statusCode).toBe(200);
    const pending = await app.inject({
      method: 'GET',
      url: '/api/comments?status=pending',
      headers: { cookie },
    });
    expect(pending.json<{ items: unknown[] }>().items).toHaveLength(0);
    const addressed = await app.inject({
      method: 'GET',
      url: '/api/comments?status=addressed',
      headers: { cookie },
    });
    expect(addressed.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it('400 on invalid status', async () => {
    seedComment('a', 'org/a', 'alice', '2026-06-01T10:00:00Z');
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/a/status',
      headers: { cookie },
      payload: { status: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 3; i++) {
      seedComment(`c${i}`, 'org/a', 'alice', `2026-06-0${i + 1}T10:00:00Z`);
    }
    const page1 = await app.inject({
      method: 'GET',
      url: '/api/comments?limit=2',
      headers: { cookie },
    });
    const b1 = page1.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(b1.items).toHaveLength(2);
    expect(b1.nextCursor).not.toBeNull();
    const page2 = await app.inject({
      method: 'GET',
      url: `/api/comments?limit=2&cursor=${encodeURIComponent(b1.nextCursor!)}`,
      headers: { cookie },
    });
    const b2 = page2.json<{ items: unknown[] }>();
    expect(b2.items).toHaveLength(1);
  });
});
