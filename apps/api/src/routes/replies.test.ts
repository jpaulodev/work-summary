import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { createOAuthConnectionService } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;

function seedGithubComment(id: string, commentUrl: string): void {
  db.prepare(
    `INSERT INTO notified_comments
       (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at, comment_url)
     VALUES (?, 'github', 'me/repo', 'issue', 1, ?, 'alice', '[]', '2026-06-01T00:00:00Z', ?)`,
  ).run(id, id, commentUrl);
}

function configureGithub(): void {
  // The reply path reads the GitHub token from the OAuth connection.
  createOAuthConnectionService(db, TEST_KEY).save(1, 'github', {
    accessToken: 'ghp_token',
    accountLogin: 'me',
  });
}

beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/comments/:id/reply', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/comments/x/reply' });
    expect(res.statusCode).toBe(401);
  });

  it('posts a github reply and marks the comment addressed', async () => {
    seedGithubComment('c1', 'https://github.com/me/repo/issues/1#issuecomment-1');
    configureGithub();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 999, html_url: 'https://x/999' }), { status: 201 }),
        ),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/c1/reply',
      headers: { cookie },
      payload: { body: 'thanks' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ reply: { body: string } }>().reply.body).toBe('thanks');
    const status = db
      .prepare('SELECT status FROM comment_status WHERE comment_id = ?')
      .get('c1') as { status: string } | undefined;
    expect(status?.status).toBe('addressed');
  });

  it('returns 400 token-write-scope on 403 and leaves status unchanged', async () => {
    seedGithubComment('c2', 'https://github.com/me/repo/issues/2#issuecomment-2');
    configureGithub();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/c2/reply',
      headers: { cookie },
      payload: { body: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('token-write-scope');
    const status = db.prepare('SELECT status FROM comment_status WHERE comment_id = ?').get('c2');
    expect(status).toBeUndefined();
  });

  it('400 on empty body', async () => {
    seedGithubComment('c3', 'https://github.com/me/repo/issues/3#issuecomment-3');
    const res = await app.inject({
      method: 'POST',
      url: '/api/comments/c3/reply',
      headers: { cookie },
      payload: { body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id/replies returns the reply history', async () => {
    seedGithubComment('c4', 'https://github.com/me/repo/issues/4#issuecomment-4');
    configureGithub();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, html_url: 'https://x/1' }), { status: 201 }),
        ),
    );
    await app.inject({
      method: 'POST',
      url: '/api/comments/c4/reply',
      headers: { cookie },
      payload: { body: 'first' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/comments/c4/replies',
      headers: { cookie },
    });
    expect(res.json<Array<{ body: string }>>().map((r) => r.body)).toEqual(['first']);
  });
});
