import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { createOAuthConnectionService } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;

function connectJira(): void {
  createOAuthConnectionService(db, TEST_KEY).save(1, 'jira', {
    accessToken: 'jira_access_secret',
    refreshToken: 'rt',
    expiresAt: '2026-06-01T01:00:00Z',
    cloudId: 'cloud-1',
    siteUrl: 'https://acme.atlassian.net',
  });
}

beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});
afterEach(() => vi.unstubAllGlobals());

describe('/api/jira', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jira/site' });
    expect(res.statusCode).toBe(401);
  });

  it('reports not connected when there is no JIRA OAuth connection', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jira/site', headers: { cookie } });
    expect(res.json<{ connected: boolean }>().connected).toBe(false);
  });

  it('materializes a single site from the OAuth connection', async () => {
    connectJira();
    const res = await app.inject({ method: 'GET', url: '/api/jira/site', headers: { cookie } });
    const body = res.json<{ connected: boolean; site: { id: string; baseUrl: string } }>();
    expect(body.connected).toBe(true);
    expect(body.site.id).toBe('cloud-1');
    expect(body.site.baseUrl).toBe('https://acme.atlassian.net');
    expect(JSON.stringify(body)).not.toContain('jira_access_secret'); // no token material
  });

  it('updates the developer field setting', async () => {
    connectJira();
    await app.inject({ method: 'GET', url: '/api/jira/site', headers: { cookie } });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/jira/site',
      headers: { cookie },
      payload: { developerFieldId: 'customfield_42' },
    });
    expect(put.json<{ developerFieldId: string }>().developerFieldId).toBe('customfield_42');
  });

  it('412 on settings/projects when JIRA is not connected', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/jira/site/projects',
      headers: { cookie },
      payload: { projects: [] },
    });
    expect(put.statusCode).toBe(412);
    expect(put.json<{ error: string }>().error).toBe('jira-not-connected');
  });

  it('replaces project selection for the connected site', async () => {
    connectJira();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/jira/site/projects',
      headers: { cookie },
      payload: { projects: [{ projectKey: 'WS', projectName: 'Work Summary' }] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({
      method: 'GET',
      url: '/api/jira/site/projects',
      headers: { cookie },
    });
    expect(get.json<Array<{ projectKey: string }>>()[0]?.projectKey).toBe('WS');
  });

  it('discovers projects through the OAuth client', async () => {
    connectJira();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ values: [{ key: 'WS', name: 'Work Summary' }] }), {
          status: 200,
        }),
      ),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/jira/site/projects/discover',
      headers: { cookie },
    });
    const body = res.json<Array<{ key: string }>>();
    expect(body[0]?.key).toBe('WS');
    // the request went to api.atlassian.com/ex/jira/{cloudId}
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/ex/jira/cloud-1/');
  });

  it('disconnects, clearing the connection and the site', async () => {
    connectJira();
    await app.inject({ method: 'GET', url: '/api/jira/site', headers: { cookie } });
    const del = await app.inject({ method: 'DELETE', url: '/api/jira/site', headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const res = await app.inject({ method: 'GET', url: '/api/jira/site', headers: { cookie } });
    expect(res.json<{ connected: boolean }>().connected).toBe(false);
    expect(createOAuthConnectionService(db, TEST_KEY).getTokens(1, 'jira')).toBeNull();
  });
});
