import { describe, it, expect, vi, afterEach } from 'vitest';
import { JiraSource } from './jira-source.js';
import type { JiraSiteRow, JiraProjectRow } from '@work-summary/storage';

afterEach(() => vi.unstubAllGlobals());

const site: JiraSiteRow = {
  id: 's',
  baseUrl: 'https://x.atlassian.net',
  email: 'me@x',
  encryptedToken: 'enc',
  tokenNonce: 'nonce',
  developerFieldId: null,
  enabled: true,
  createdAt: '',
  updatedAt: '',
};
const project: JiraProjectRow = { id: 1, siteId: 's', projectKey: 'WS', projectName: 'Work' };

describe('JiraSource', () => {
  it('filters out comments authored by the current user and normalizes the rest', async () => {
    const now = new Date().toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/myself'))
          return Promise.resolve(
            new Response(JSON.stringify({ accountId: 'me' }), { status: 200 }),
          );
        if (url.includes('/search'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                issues: [{ id: '1', key: 'WS-7', fields: { summary: 'Fix it', updated: now } }],
                total: 1,
                isLast: true,
              }),
              { status: 200 },
            ),
          );
        if (url.includes('/comment'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                comments: [
                  {
                    id: 'c1',
                    created: now,
                    updated: now,
                    author: { accountId: 'me', displayName: 'Me' },
                    body: {
                      type: 'doc',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'self' }] }],
                    },
                  },
                  {
                    id: 'c2',
                    created: now,
                    updated: now,
                    author: { accountId: 'other', displayName: 'Other Person' },
                    body: {
                      type: 'doc',
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'asking you' }] },
                      ],
                    },
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(new Response('', { status: 404 }));
      }),
    );

    const source = new JiraSource({
      sites: [site],
      projects: [project],
      decryptToken: () => 'tok',
      since: new Date(Date.now() - 7 * 86400000),
      sleep: () => Promise.resolve(),
    });
    const out = await source.fetchPendingComments();
    expect(out).toHaveLength(1);
    expect(out[0]?.author.login).toBe('Other Person');
    expect(out[0]?.source).toBe('jira');
    expect(out[0]?.issueKey).toBe('WS-7');
    expect(out[0]?.containerNumber).toBe(7);
    expect(out[0]?.body).toContain('asking you');
    expect(out[0]?.commentUrl).toContain('focusedCommentId=c2');
  });

  it('isolates a failing site and still returns other sites results', async () => {
    const goodSite = { ...site, id: 'good', baseUrl: 'https://good.atlassian.net' };
    const badSite = { ...site, id: 'bad', baseUrl: 'https://bad.atlassian.net' };
    const now = new Date().toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.startsWith('https://bad.'))
          return Promise.resolve(new Response('', { status: 500 }));
        if (url.endsWith('/myself'))
          return Promise.resolve(
            new Response(JSON.stringify({ accountId: 'me' }), { status: 200 }),
          );
        if (url.includes('/search'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                issues: [{ id: '1', key: 'WS-1', fields: { summary: 's', updated: now } }],
                total: 1,
              }),
              { status: 200 },
            ),
          );
        if (url.includes('/comment'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                comments: [
                  {
                    id: 'c1',
                    created: now,
                    updated: now,
                    author: { accountId: 'other', displayName: 'Other' },
                    body: {
                      type: 'doc',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
                    },
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(new Response('', { status: 404 }));
      }),
    );
    const source = new JiraSource({
      sites: [badSite, goodSite],
      projects: [
        { id: 1, siteId: 'bad', projectKey: 'WS', projectName: 'W' },
        { id: 2, siteId: 'good', projectKey: 'WS', projectName: 'W' },
      ],
      decryptToken: () => 'tok',
      since: new Date(0),
      sleep: () => Promise.resolve(),
      logger: { error: () => undefined },
    });
    const out = await source.fetchPendingComments();
    expect(out).toHaveLength(1);
  });

  it('skips projects whose key is not a valid JQL-safe project key', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accountId: 'me' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const source = new JiraSource({
      sites: [site],
      projects: [
        { id: 1, siteId: 's', projectKey: 'X" OR project IS NOT EMPTY', projectName: 'evil' },
      ],
      decryptToken: () => 'tok',
      since: new Date(0),
      sleep: () => Promise.resolve(),
    });
    const out = await source.fetchPendingComments();
    expect(out).toEqual([]);
    // only /myself was called; no /search with the injected JQL
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes('/search'))).toBe(true);
  });

  it('skips disabled sites', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const source = new JiraSource({
      sites: [{ ...site, enabled: false }],
      projects: [project],
      decryptToken: () => 'tok',
      since: new Date(0),
      sleep: () => Promise.resolve(),
    });
    expect(await source.fetchPendingComments()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
