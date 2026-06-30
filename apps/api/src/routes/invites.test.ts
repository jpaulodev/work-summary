import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let adminCookie: string;

beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  adminCookie = await authedCookie(app); // user 1 = admin
});

async function createInvite(role: 'admin' | 'member' = 'member'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/invites',
    headers: { cookie: adminCookie },
    payload: { role },
  });
  return res.json<{ token: string }>().token;
}

/** Register a new user from an invite token; returns their session cookie. */
async function registerMember(
  token: string,
  username: string,
): Promise<{ status: number; cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { token, username, password: 'pw1234567' },
  });
  const c = res.headers['set-cookie'];
  return { status: res.statusCode, cookie: Array.isArray(c) ? c.join('; ') : (c ?? '') };
}

describe('invites + registration', () => {
  it('requires admin to create invites', async () => {
    const noAuth = await app.inject({ method: 'POST', url: '/api/invites' });
    expect(noAuth.statusCode).toBe(401);

    const token = await createInvite();
    const { cookie } = await registerMember(token, 'bob');
    const asMember = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: { cookie },
      payload: {},
    });
    expect(asMember.statusCode).toBe(403);
  });

  it('admin can create an invite and a member can register with it', async () => {
    const token = await createInvite();
    const { status, cookie } = await registerMember(token, 'bob');
    expect(status).toBe(201);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json<{ username: string; role: string }>()).toMatchObject({
      username: 'bob',
      role: 'member',
    });
  });

  it('rejects an unknown or already-consumed invite', async () => {
    const bad = await registerMember('nope', 'x');
    expect(bad.status).toBe(400);

    const token = await createInvite();
    await registerMember(token, 'bob');
    const reuse = await registerMember(token, 'carol');
    expect(reuse.status).toBe(400);
  });

  it('rejects an expired invite', async () => {
    const token = await createInvite();
    db.prepare('UPDATE invite SET expires_at = ? WHERE token = ?').run(
      '2000-01-01T00:00:00Z',
      token,
    );
    const res = await registerMember(token, 'bob');
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate username', async () => {
    const t1 = await createInvite();
    await registerMember(t1, 'bob');
    const t2 = await createInvite();
    const dup = await registerMember(t2, 'bob');
    expect(dup.status).toBe(409);
  });
});

describe('data isolation', () => {
  it('a member cannot see the admin comments', async () => {
    // Seed a notified comment for the admin (user 1) and the member (user 2).
    const member = await registerMember(await createInvite(), 'bob'); // becomes user 2
    const seed = (userId: number, id: string): void => {
      db.prepare(
        `INSERT INTO notified_comments
             (user_id, id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
           VALUES (?, ?, 'github', 'org/repo', 'issue', 1, ?, 'alice', '[]', '2026-06-01T00:00:00Z')`,
      ).run(userId, id, id);
    };
    seed(1, 'admin-comment');
    seed(2, 'member-comment');

    const adminList = await app.inject({
      method: 'GET',
      url: '/api/comments',
      headers: { cookie: adminCookie },
    });
    const memberList = await app.inject({
      method: 'GET',
      url: '/api/comments',
      headers: { cookie: member.cookie },
    });
    const ids = (r: typeof adminList): string[] =>
      r.json<{ items: Array<{ id: string }> }>().items.map((i) => i.id);
    expect(ids(adminList)).toEqual(['admin-comment']);
    expect(ids(memberList)).toEqual(['member-comment']);
  });
});
