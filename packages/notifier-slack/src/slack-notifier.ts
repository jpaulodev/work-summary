import type { PendingComment } from '@work-summary/core';
import type { Notifier, NotificationPayload } from '@work-summary/notifiers';

export interface SlackNotifierOptions {
  webhookUrl: string;
}

function commentRef(c: PendingComment): string {
  return c.issueKey ?? `#${c.containerNumber}`;
}

function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export function buildSlackPayload(payload: NotificationPayload): {
  text: string;
  blocks: SlackBlock[];
} {
  const count = payload.comments.length;
  const head: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: 'Work Summary' } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${count}* pending comments` },
    },
    { type: 'divider' },
  ];
  const items: SlackBlock[] = payload.comments.slice(0, 10).map((c) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text:
        `*<${c.commentUrl}|${escapeMrkdwn(c.repo)} ${escapeMrkdwn(commentRef(c))}>*\n` +
        `_${escapeMrkdwn(c.author.login)}_: ${escapeMrkdwn(c.body.slice(0, 200))}`,
    },
  }));
  const remaining = count - items.length;
  const footer: SlackBlock = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: remaining > 0 ? `+ ${remaining} more comments in the dashboard` : payload.subject,
      },
    ],
  };
  return {
    text: `Work Summary - ${count} pending comments`,
    blocks: [...head, ...items, footer],
  };
}

export class SlackNotifier implements Notifier {
  readonly id = 'slack';
  constructor(private readonly opts: SlackNotifierOptions) {}

  async send(payload: NotificationPayload): Promise<void> {
    const res = await fetch(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSlackPayload(payload)),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}`);
    }
  }
}
