import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJiraReply } from './reply.js';
import { textToAdf } from './text-to-adf.js';
import { JiraClient } from './client.js';

afterEach(() => vi.unstubAllGlobals());

describe('textToAdf', () => {
  it('wraps each non-empty line in a paragraph', () => {
    expect(textToAdf('hello\nworld')).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
      ],
    });
  });

  it('drops empty lines', () => {
    expect(textToAdf('a\n\nb').content).toHaveLength(2);
  });
});

describe('postJiraReply', () => {
  it('POSTs an ADF comment to the issue endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '10001', self: 'https://x.atlassian.net/.../10001' }), {
        status: 201,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new JiraClient({
      baseUrl: 'https://x.atlassian.net',
      email: 'me@x',
      token: 'tok',
    });
    const r = await postJiraReply({ client, issueKey: 'WS-1', body: 'noted' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/rest/api/3/issue/WS-1/comment');
    const reqBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
      body: { type: string; content: { content: { text: string }[] }[] };
    };
    expect(reqBody.body.type).toBe('doc');
    expect(reqBody.body.content[0]?.content[0]?.text).toBe('noted');
    expect(r.id).toBe('10001');
  });

  it('maps 401 to token-write-scope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    const client = new JiraClient({ baseUrl: 'https://x', email: 'a', token: 'b' });
    await expect(postJiraReply({ client, issueKey: 'WS-1', body: 'x' })).rejects.toMatchObject({
      code: 'token-write-scope',
    });
  });
});
