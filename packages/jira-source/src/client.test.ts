import { describe, it, expect, vi, afterEach } from 'vitest';
import { JiraClient } from './client.js';

afterEach(() => vi.unstubAllGlobals());

describe('JiraClient', () => {
  it('sends Basic auth derived from email:token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accountId: 'u1', emailAddress: 'me@x.com' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JiraClient({
      baseUrl: 'https://acme.atlassian.net',
      email: 'me@x.com',
      token: 'tok',
    });
    await client.myself();
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe('Basic ' + Buffer.from('me@x.com:tok').toString('base64'));
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
      baseUrl: 'https://x.atlassian.net',
      email: 'a',
      token: 'b',
      sleep: () => Promise.resolve(),
    });
    const r = await client.search('project = WS');
    expect(calls).toBe(2);
    expect(r.total).toBe(0);
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const client = new JiraClient({ baseUrl: 'https://x.atlassian.net', email: 'a', token: 'b' });
    await expect(client.myself()).rejects.toThrow(/401/);
  });
});
