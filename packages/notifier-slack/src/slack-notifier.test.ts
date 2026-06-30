import { describe, it, expect, vi, afterEach } from 'vitest';
import { SlackNotifier, buildSlackPayload } from './slack-notifier.js';
import type { NotificationPayload } from '@work-summary/notifiers';
import type { PendingComment } from '@work-summary/core';

afterEach(() => vi.unstubAllGlobals());

function comment(over: Partial<PendingComment> = {}): PendingComment {
  return {
    id: 'c',
    source: 'github',
    repo: 'me/repo',
    containerType: 'pr',
    containerNumber: 42,
    containerTitle: '',
    containerUrl: '',
    commentId: 'c',
    commentUrl: 'https://github.com/me/repo/pull/42#c',
    author: { login: 'alice', isBot: false },
    body: 'please review',
    createdAt: '2026-06-01T00:00:00Z',
    matchedRules: ['mentioned'],
    ...over,
  };
}

function payload(comments: PendingComment[]): NotificationPayload {
  return { subject: 'Open dashboard', comments, generatedAt: '2026-06-01T00:00:00Z' };
}

describe('SlackNotifier', () => {
  it('POSTs a Block Kit payload to the webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/AB/CD' }).send(
      payload([comment(), comment({ id: 'c2', author: { login: 'bob', isBot: false } })]),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/AB/CD',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
      text: string;
      blocks: { type: string }[];
    };
    expect(body.text).toMatch(/2 pending comments/);
    expect(body.blocks[0]?.type).toBe('header');
    expect(body.blocks.some((b) => b.type === 'section')).toBe(true);
  });

  it('caps the rendered comment sections at 10', () => {
    const built = buildSlackPayload(payload(Array.from({ length: 25 }, () => comment())));
    expect(built.blocks.filter((b) => b.type === 'section').length).toBeLessThanOrEqual(11);
  });

  it('escapes mrkdwn-significant characters in the body', () => {
    const built = buildSlackPayload(payload([comment({ body: 'a < b & c > d' })]));
    expect(JSON.stringify(built)).toContain('a &lt; b &amp; c &gt; d');
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })));
    await expect(
      new SlackNotifier({ webhookUrl: 'https://x' }).send(payload([comment()])),
    ).rejects.toThrow(/400/);
  });
});
