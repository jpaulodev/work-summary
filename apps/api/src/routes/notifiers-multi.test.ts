import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let cookie: string;
beforeEach(async () => {
  ({ app } = await makeTestApp());
  cookie = await authedCookie(app);
});
afterEach(() => vi.unstubAllGlobals());

describe('notifiers (slack/teams)', () => {
  it('creates a slack notifier and lists it without the webhook', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/notifiers',
      headers: { cookie },
      payload: { type: 'slack', name: 'team-channel', webhookUrl: 'https://hooks.slack.com/X/Y' },
    });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/notifiers', headers: { cookie } });
    const body = list.json<{ items: Array<{ type: string; name: string }> }>();
    expect(body.items.some((i) => i.type === 'slack' && i.name === 'team-channel')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('hooks.slack.com');
  });

  it('rejects an unknown notifier type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifiers',
      headers: { cookie },
      payload: { type: 'discord', name: 'x', webhookUrl: 'https://x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-Slack URL for a slack notifier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifiers',
      headers: { cookie },
      payload: { type: 'slack', name: 'x', webhookUrl: 'https://evil.example.com/x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /:id/test sends a synthetic digest via the webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const create = await app.inject({
      method: 'POST',
      url: '/api/notifiers',
      headers: { cookie },
      payload: { type: 'slack', name: 'team', webhookUrl: 'https://hooks.slack.com/A/B' },
    });
    const id = create.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/notifiers/${id}/test`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/A/B',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
