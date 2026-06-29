import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchOpenPullRequests, fetchPullRequestReviews } from './fetch-prs.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchOpenPullRequests', () => {
  it('returns normalized PR list with head commit timestamp', async () => {
    const client = createOctokit({ token: 'fake' });
    const prs = await fetchOpenPullRequests(client, 'org/r');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 7,
      title: 'feat: add x',
      htmlUrl: 'https://github.com/org/r/pull/7',
      authorLogin: 'me',
      assigneeLogins: ['jane'],
      lastCommitAt: '2026-06-01T09:00:00Z',
    });
  });
});

describe('fetchPullRequestReviews', () => {
  it('returns reviews with normalized author and state', async () => {
    const client = createOctokit({ token: 'fake' });
    const reviews = await fetchPullRequestReviews(client, 'org/r', 7);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      state: 'CHANGES_REQUESTED',
      author: { login: 'alice', isBot: false },
      submittedAt: '2026-06-01T10:00:00Z',
    });
  });
});
