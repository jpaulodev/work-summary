import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { createOAuthConnectionService } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;
beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});
afterEach(() => vi.unstubAllGlobals());

const validRules = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

interface SourcesBody {
  github: {
    repos: string[];
    connection: { accountLogin: string | null } | null;
  };
}

describe('sources routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources' });
    expect(res.statusCode).toBe(401);
  });

  it('reports no connection when GitHub is not connected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json<SourcesBody>().github.connection).toBeNull();
    expect(res.json<SourcesBody>().github.repos).toEqual([]);
  });

  it('PUT then GET round-trips repos/rules/filters (no token in this path)', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/sources/github',
      headers: { cookie },
      payload: {
        enabled: true,
        repos: ['org/a'],
        rules: validRules,
        filters: { excludeBots: true, botWhitelist: [] },
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie } });
    expect(get.json<SourcesBody>().github.repos).toEqual(['org/a']);
  });

  it('surfaces the OAuth connection account in GET /sources', async () => {
    createOAuthConnectionService(db, TEST_KEY).save(1, 'github', {
      accessToken: 'gho_token',
      accountLogin: 'octocat',
    });
    const get = await app.inject({ method: 'GET', url: '/api/sources', headers: { cookie } });
    expect(get.json<SourcesBody>().github.connection?.accountLogin).toBe('octocat');
    expect(get.payload).not.toContain('gho_token');
  });

  it('400 on invalid rules', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/sources/github',
      headers: { cookie },
      payload: { rules: { authorOfPrUnanswered: 'yes' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('412 on repo discovery when GitHub is not connected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sources/github/repos',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(412);
    expect(res.json<{ error: string }>().error).toBe('github-not-connected');
  });

  it('lists accessible repos from GitHub when connected', async () => {
    createOAuthConnectionService(db, TEST_KEY).save(1, 'github', {
      accessToken: 'gho_token',
      accountLogin: 'octocat',
    });
    // Octokit calls GET /user/repos; one page, no Link header => no pagination.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { full_name: 'octocat/hello-world', private: false },
            { full_name: 'acme/secret-api', private: true },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/sources/github/repos',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ repos: Array<{ fullName: string }> }>().repos.map((r) => r.fullName)).toEqual(
      ['octocat/hello-world', 'acme/secret-api'],
    );
  });
});
