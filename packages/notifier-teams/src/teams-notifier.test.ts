import { describe, it, expect, vi, afterEach } from 'vitest';
import { TeamsNotifier, buildTeamsPayload } from './teams-notifier.js';
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
  return { subject: 's', comments, generatedAt: '2026-06-01T00:00:00Z' };
}

describe('TeamsNotifier', () => {
  it('POSTs an Adaptive Card 1.4 to the webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('1', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new TeamsNotifier({ webhookUrl: 'https://outlook.office.com/webhook/XYZ' }).send(
      payload([comment(), comment({ id: 'c2' })]),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
      type: string;
      attachments: Array<{
        contentType: string;
        content: { type: string; version: string; body: unknown[] };
      }>;
    };
    expect(body.type).toBe('message');
    expect(body.attachments[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(body.attachments[0]?.content.type).toBe('AdaptiveCard');
    expect(body.attachments[0]?.content.version).toBe('1.4');
    expect(JSON.stringify(body.attachments[0]?.content.body)).toMatch(/2 pending comments/);
  });

  it('caps containers at 10', () => {
    const built = buildTeamsPayload(payload(Array.from({ length: 25 }, () => comment())));
    const containers = (built.attachments[0]?.content.body as { type: string }[]).filter(
      (b) => b.type === 'Container',
    );
    expect(containers.length).toBeLessThanOrEqual(10);
  });

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(
      new TeamsNotifier({ webhookUrl: 'https://x' }).send(payload([comment()])),
    ).rejects.toThrow(/500/);
  });
});
