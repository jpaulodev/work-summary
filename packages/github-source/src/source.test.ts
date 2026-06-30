import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createOctokit } from './client.js';
import { GithubSource } from './source.js';
import { buildServer } from '../test/msw-server.js';
import { http, HttpResponse } from 'msw';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GithubSource.fetchPendingComments', () => {
  it('returns matched pending comments from configured repo', async () => {
    server.use(
      http.get('https://api.github.com/repos/:owner/:repo/issues/42/comments', () =>
        HttpResponse.json([
          {
            id: 999,
            body: 'cc @me',
            html_url: 'https://gh/c/999',
            user: { login: 'carol', type: 'User' },
            created_at: '2026-06-02T10:00:00Z',
          },
        ]),
      ),
      http.get('https://api.github.com/repos/:owner/:repo/pulls/42/comments', () =>
        HttpResponse.json([]),
      ),
    );

    const client = createOctokit({ token: 'fake' });
    const source = new GithubSource(client);
    const result = await source.fetchPendingComments({
      repos: ['org/r'],
      userLogin: 'me',
      sinceByRepo: {},
      defaultSince: '2026-05-01T00:00:00Z',
      rules: {
        authorOfPrUnanswered: true,
        mentioned: true,
        repliedBeforeThenFollowup: true,
        assignee: true,
        changesRequested: true,
      },
      filters: { excludeBots: false, botWhitelist: [] },
      concurrency: 2,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((c) => c.matchedRules.includes('changes_requested'))).toBe(true);
    expect(result.some((c) => c.matchedRules.includes('mentioned'))).toBe(true);
  }, 15000);

  it('reports onRepoDone once per repo with a running count', async () => {
    server.use(
      http.get('https://api.github.com/repos/:owner/:repo/issues/:n/comments', () =>
        HttpResponse.json([]),
      ),
      http.get('https://api.github.com/repos/:owner/:repo/pulls/:n/comments', () =>
        HttpResponse.json([]),
      ),
    );
    const onRepoDone = vi.fn();
    const source = new GithubSource(createOctokit({ token: 'fake' }));
    await source.fetchPendingComments({
      repos: ['org/a', 'org/b', 'org/c'],
      userLogin: 'me',
      sinceByRepo: {},
      defaultSince: '2026-05-01T00:00:00Z',
      rules: {
        authorOfPrUnanswered: true,
        mentioned: true,
        repliedBeforeThenFollowup: true,
        assignee: true,
        changesRequested: true,
      },
      filters: { excludeBots: false, botWhitelist: [] },
      concurrency: 2,
      onRepoDone,
    });
    expect(onRepoDone).toHaveBeenCalledTimes(3);
    // Final call reports all three repos done out of three.
    expect(onRepoDone).toHaveBeenLastCalledWith(3, 3);
  }, 15000);
});
