import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let cookie: string;
beforeEach(async () => {
  ({ app } = await makeTestApp());
  cookie = await authedCookie(app);
});

const validRules = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

describe('sources routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(401);
  });

  it('returns null github when unset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ github: null });
  });

  it('PUT then GET round-trips config without leaking the token', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/sources/github',
      headers: { cookie },
      payload: {
        enabled: true,
        token: 'ghp_secret',
        repos: ['org/a'],
        rules: validRules,
        filters: { excludeBots: true, botWhitelist: [] },
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie } });
    const body = get.json<{ github: { repos: string[]; hasToken: boolean } }>();
    expect(body.github.repos).toEqual(['org/a']);
    expect(body.github.hasToken).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ghp_secret');
  });

  it('400 on invalid rules', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sources/github',
      headers: { cookie },
      payload: { token: 'x', rules: { authorOfPrUnanswered: 'yes' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
