import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchIssueComments, fetchPrReviewComments } from './fetch-comments.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchIssueComments', () => {
  it('normalizes issue/conversation comments', async () => {
    const client = createOctokit({ token: 'fake' });
    const comments = await fetchIssueComments(client, 'org/r', 7);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      nativeId: '100',
      url: 'https://gh/c/100',
      author: { login: 'alice', isBot: false },
      body: 'please review',
      createdAt: '2026-06-01T10:30:00Z',
    });
  });
});

describe('fetchPrReviewComments', () => {
  it('normalizes inline PR review comments', async () => {
    const client = createOctokit({ token: 'fake' });
    const comments = await fetchPrReviewComments(client, 'org/r', 7);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      nativeId: '200',
      author: { login: 'bob' },
      body: 'nit: rename',
    });
  });
});
