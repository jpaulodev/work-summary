import type { PendingComment } from '@work-summary/core';
import type { Notifier, NotificationPayload } from '@work-summary/notifiers';

export interface TeamsNotifierOptions {
  webhookUrl: string;
}

function commentRef(c: PendingComment): string {
  return c.issueKey ?? `#${c.containerNumber}`;
}

interface CardElement {
  type: string;
  [key: string]: unknown;
}

export function buildTeamsPayload(payload: NotificationPayload): {
  type: string;
  attachments: Array<{ contentType: string; content: Record<string, unknown> }>;
} {
  const count = payload.comments.length;
  const containers: CardElement[] = payload.comments.slice(0, 10).map((c) => ({
    type: 'Container',
    items: [
      {
        type: 'TextBlock',
        text: `${c.repo} ${commentRef(c)}`,
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `${c.author.login}: ${c.body.slice(0, 200)}`,
        wrap: true,
        isSubtle: true,
      },
    ],
    selectAction: { type: 'Action.OpenUrl', url: c.commentUrl },
  }));
  const overflow: CardElement[] =
    count > containers.length
      ? [
          {
            type: 'TextBlock',
            text: `+ ${count - containers.length} more in the dashboard`,
            wrap: true,
            isSubtle: true,
          },
        ]
      : [];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          body: [
            { type: 'TextBlock', text: 'Work Summary', size: 'Large', weight: 'Bolder' },
            { type: 'TextBlock', text: `${count} pending comments`, wrap: true },
            ...containers,
            ...overflow,
          ],
        },
      },
    ],
  };
}

export class TeamsNotifier implements Notifier {
  readonly id = 'teams';
  constructor(private readonly opts: TeamsNotifierOptions) {}

  async send(payload: NotificationPayload): Promise<void> {
    const res = await fetch(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildTeamsPayload(payload)),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook returned ${res.status}`);
    }
  }
}
