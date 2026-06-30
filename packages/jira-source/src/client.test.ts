import { describe, it, expect, vi, afterEach } from 'vitest';
import { JiraClient } from './client.js';

afterEach(() => vi.unstubAllGlobals());

describe('JiraClient', () => {
  it('sends a Bearer token against the cloud-id base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accountId: 'u1', emailAddress: 'me@x.com' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JiraClient({ accessToken: 'tok', cloudId: 'cloud-1' });
    await client.myself();
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself');
    expect(init.headers.authorization).toBe('Bearer tok');
  });

  it('retries once on 429 then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls === 1)
        return Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '0' } }));
      return Promise.resolve(
        new Response(JSON.stringify({ issues: [], total: 0, isLast: true }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new JiraClient({
      accessToken: 'tok',
      cloudId: 'cloud-1',
      sleep: () => Promise.resolve(),
    });
    const r = await client.search('project = WS');
    expect(calls).toBe(2);
    expect(r.total).toBe(0);
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const client = new JiraClient({ accessToken: 'tok', cloudId: 'cloud-1' });
    await expect(client.myself()).rejects.toThrow(/401/);
  });
});
