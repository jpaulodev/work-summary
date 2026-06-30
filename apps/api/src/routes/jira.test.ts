import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { encryptSecret } from '@work-summary/auth';
import { JiraSiteRepository } from '@work-summary/storage';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;
beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});
afterEach(() => vi.unstubAllGlobals());

describe('/api/jira', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jira/sites' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /sites returns 400 when the connection check fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const res = await app.inject({
      method: 'POST',
      url: '/api/jira/sites',
      headers: { cookie },
      payload: { baseUrl: 'https://x.atlassian.net', email: 'a@b.com', token: 'badtoken1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/connection failed/i);
  });

  it('POST /sites validates then stores the site (token never returned)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ accountId: 'me' }), { status: 200 })),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/jira/sites',
      headers: { cookie },
      payload: { baseUrl: 'https://x.atlassian.net', email: 'a@b.com', token: 'goodtoken1' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty('encryptedToken');
    expect(body).not.toHaveProperty('token');
    expect(body.hasToken).toBe(true);
    expect(JSON.stringify(body)).not.toContain('goodtoken1');
  });

  it('GET /sites redacts the encrypted token', async () => {
    const enc = encryptSecret('secret-token', TEST_KEY);
    new JiraSiteRepository(db).insert({
      id: 's1',
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.com',
      encryptedToken: enc.ciphertext,
      tokenNonce: enc.nonce,
      developerFieldId: null,
      enabled: true,
    });
    const res = await app.inject({ method: 'GET', url: '/api/jira/sites', headers: { cookie } });
    const body = res.json<Array<Record<string, unknown>>>();
    expect(body[0]).not.toHaveProperty('encryptedToken');
    expect(body[0]).not.toHaveProperty('tokenNonce');
    expect(body[0]?.hasToken).toBe(true);
  });

  it('replaces project selection for a site', async () => {
    const enc = encryptSecret('t', TEST_KEY);
    new JiraSiteRepository(db).insert({
      id: 's1',
      baseUrl: 'https://x.atlassian.net',
      email: 'a@b.com',
      encryptedToken: enc.ciphertext,
      tokenNonce: enc.nonce,
      developerFieldId: null,
      enabled: true,
    });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/jira/sites/s1/projects',
      headers: { cookie },
      payload: { projects: [{ projectKey: 'WS', projectName: 'Work Summary' }] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET',
      url: '/api/jira/sites/s1/projects',
      headers: { cookie },
    });
    expect(get.json<Array<{ projectKey: string }>>()[0]?.projectKey).toBe('WS');
  });
});
