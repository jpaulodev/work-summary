import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchMentionedContainers } from './fetch-mentions.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchMentionedContainers', () => {
  it('returns containers distinguished by pr/issue', async () => {
    const client = createOctokit({ token: 'fake' });
    const result = await fetchMentionedContainers(client, { login: 'me', repos: ['org/r'] });
    expect(result.sort((a, b) => a.number - b.number)).toEqual([
      { repo: 'org/r', number: 7, type: 'pr' },
      { repo: 'org/r', number: 42, type: 'issue' },
    ]);
  });

  it('returns empty list when login has no mentions', async () => {
    const client = createOctokit({ token: 'fake' });
    const result = await fetchMentionedContainers(client, { login: 'nobody', repos: ['org/r'] });
    expect(result).toEqual([]);
  });
});
