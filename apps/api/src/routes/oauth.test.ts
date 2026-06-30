import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';
import { createOAuthConnectionService } from '@work-summary/config-db';
import { TEST_KEY } from '../test-helpers.js';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;

beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
  vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'cid');
  vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'secret');
  vi.stubEnv('PUBLIC_BASE_URL', 'http://127.0.0.1:3001');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Extract the `ws_oauth_state=...` pair from a set-cookie header. */
function stateCookie(setCookie: string | string[] | undefined): string {
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const c = arr.find((s) => s.startsWith('ws_oauth_state='));
  return (c ?? '').split(';')[0] ?? '';
}

describe('GET /api/oauth/github/start', () => {
  it('401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/oauth/github/start' });
    expect(res.statusCode).toBe(401);
  });

  it('redirects to GitHub with a state cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3001/api/oauth/github/callback',
    );
    expect(loc.searchParams.get('state')).toBeTruthy();
    expect(stateCookie(res.headers['set-cookie'])).toContain('ws_oauth_state=');
  });

  it('501 when client credentials are not configured', async () => {
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', '');
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/github/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json<{ error: string }>().error).toBe('oauth-not-configured');
  });

  it('404 for an unknown provider', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/oauth/bitbucket/start',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

async function startAndGetState(): Promise<{ state: string; stateCookieHeader: string }> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/oauth/github/start',
    headers: { cookie },
  });
  const state = new URL(res.headers.location as string).searchParams.get('state') as string;
  return { state, stateCookieHeader: stateCookie(res.headers['set-cookie']) };
}

describe('GET /api/oauth/github/callback', () => {
  it('exchanges the code, stores the connection, and redirects to /sources', async () => {
    const { state, stateCookieHeader } = await startAndGetState();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('login/oauth/access_token')) {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: 'gho_token', scope: 'repo' }), {
              status: 200,
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ id: 7, login: 'octocat' }), { status: 200 }),
        );
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/github/callback?code=abc&state=${state}`,
      headers: { cookie: `${cookie}; ${stateCookieHeader}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://127.0.0.1:3001/sources?connected=github');

    const tokens = createOAuthConnectionService(db, TEST_KEY).getTokens(1, 'github');
    expect(tokens?.accessToken).toBe('gho_token');
    expect(tokens?.accountLogin).toBe('octocat');
  });

  it('rejects a mismatched state (CSRF) without storing anything', async () => {
    const { stateCookieHeader } = await startAndGetState();
    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/github/callback?code=abc&state=WRONG`,
      headers: { cookie: `${cookie}; ${stateCookieHeader}` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('oauth_error=state');
    expect(createOAuthConnectionService(db, TEST_KEY).getTokens(1, 'github')).toBeNull();
  });

  it('redirects with oauth_error when the token exchange fails', async () => {
    const { state, stateCookieHeader } = await startAndGetState();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await app.inject({
      method: 'GET',
      url: `/api/oauth/github/callback?code=abc&state=${state}`,
      headers: { cookie: `${cookie}; ${stateCookieHeader}` },
    });
    expect(res.headers.location).toContain('oauth_error=exchange');
  });
});

describe('connections list + disconnect', () => {
  it('lists and deletes a connection without leaking tokens', async () => {
    createOAuthConnectionService(db, TEST_KEY).save(1, 'github', {
      accessToken: 'gho_token',
      accountLogin: 'octocat',
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/oauth/connections',
      headers: { cookie },
    });
    const body = list.json<Array<{ provider: string; accountLogin: string }>>();
    expect(body).toHaveLength(1);
    expect(body[0]?.accountLogin).toBe('octocat');
    expect(list.payload).not.toContain('gho_token');

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/oauth/github',
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect(createOAuthConnectionService(db, TEST_KEY).getTokens(1, 'github')).toBeNull();
  });
});
