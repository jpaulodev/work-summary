# Phase 5 - Multi-channel Notifiers (Slack + Teams) - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Scope:** Phase 5 of 6

---

## Assumptions

1. Slack: **Incoming Webhooks** (no OAuth, no bot tokens). User pastes webhook URL.
2. Teams: **Incoming Webhooks** via Microsoft 365 connector. User pastes webhook URL.
3. Both use the existing `Notifier` interface from Phase 1; no breaking changes.
4. Notification format: rich Block Kit (Slack) and Adaptive Card (Teams). Falls back to plain text if rendering fails.
5. Multi-channel fanout: user can enable multiple notifier configs simultaneously; each receives the same digest.
6. Notifier configs encrypted (webhook URL contains a secret). Reuses Phase 2 encryption service.

---

## 1. Goals
- Slack notifier publishes the same digest to a configured channel via webhook.
- Teams notifier publishes the digest as an Adaptive Card.
- UI: notifier config screen lets user add/edit/delete/test multiple notifier configs (SMTP, Slack, Teams).
- "Send test" button on each config verifies the channel works.

## 2. Non-Goals
- Slack OAuth (slash commands, thread replies) - Phase 6 may address reply.
- Teams bot framework.
- Discord, PagerDuty, etc.

## 3. Stack
- Slack: HTTP POST to webhook with `blocks` payload.
- Teams: HTTP POST to webhook with Adaptive Card v1.4 JSON.
- HTTP: native fetch.

## 4. Data Model (migration 0005)

Phase 2 already created `notifier_config` (id, kind, name, enabled, encrypted_payload). Phase 5 adds no new tables; it extends the `kind` enum at the application layer: `smtp | slack | teams`. The `encrypted_payload` JSON shape is per-kind:

- `smtp` (existing): `{ host, port, secure, user, pass, from, to[] }`
- `slack`: `{ webhookUrl: string }`
- `teams`: `{ webhookUrl: string }`

Optional migration 0005 only adjusts the existing `kind` CHECK constraint if Phase 2 declared one:

```sql
-- if Phase 2 added: CHECK (kind IN ('smtp'))
-- rebuild it:
PRAGMA foreign_keys=OFF;
CREATE TABLE notifier_config_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('smtp','slack','teams')),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  encrypted_payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO notifier_config_new SELECT * FROM notifier_config;
DROP TABLE notifier_config;
ALTER TABLE notifier_config_new RENAME TO notifier_config;
PRAGMA foreign_keys=ON;
```

## 5. Notifier Packages

Two new packages mirroring Phase 1's `@work-summary/notifiers`:
- `packages/notifier-slack`
- `packages/notifier-teams`

Each exports a class implementing the existing `Notifier` interface:

```ts
export interface Notifier {
  readonly kind: string;
  send(digest: Digest): Promise<{ messageId?: string }>;
}
```

## 6. Slack Block Kit Payload

```ts
{
  text: `Work Summary - ${digest.commentsCount} pending comments`, // fallback
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: 'Work Summary' }},
    { type: 'section', text: { type: 'mrkdwn',
      text: `*${digest.commentsCount}* pending comments across *${digest.sourcesCount}* sources` }},
    { type: 'divider' },
    ...digest.comments.slice(0, 10).map(c => ({
      type: 'section',
      text: { type: 'mrkdwn',
        text: `*<${c.url}|${c.repoOrProject} #${c.refNumber}>*\n_${c.author}_: ${c.body.slice(0, 200)}` },
    })),
    digest.comments.length > 10 ? {
      type: 'context',
      elements: [{ type: 'mrkdwn',
        text: `+ ${digest.comments.length - 10} more comments. <${digest.dashboardUrl}|Open dashboard>` }],
    } : { type: 'context', elements: [{ type: 'mrkdwn',
      text: `<${digest.dashboardUrl}|Open dashboard>` }]},
  ]
}
```

## 7. Teams Adaptive Card Payload

```ts
{
  type: 'message',
  attachments: [{
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: {
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        { type: 'TextBlock', text: 'Work Summary', size: 'Large', weight: 'Bolder' },
        { type: 'TextBlock', text: `${digest.commentsCount} pending comments`, wrap: true },
        ...digest.comments.slice(0, 10).map(c => ({
          type: 'Container',
          items: [
            { type: 'TextBlock', text: `${c.repoOrProject} #${c.refNumber}`, weight: 'Bolder', wrap: true },
            { type: 'TextBlock', text: `${c.author}: ${c.body.slice(0, 200)}`, wrap: true, isSubtle: true },
          ],
          selectAction: { type: 'Action.OpenUrl', url: c.url },
        })),
      ],
      actions: [
        { type: 'Action.OpenUrl', title: 'Open dashboard', url: digest.dashboardUrl },
      ],
    },
  }],
}
```

## 8. API Surface (additions)

The existing `/api/notifiers` from Phase 2 already supports CRUD. Phase 5 adds:

| Method | Path | Notes |
|---|---|---|
| POST | /api/notifiers/:id/test | sends a synthetic test digest and returns `{ ok, error?, durationMs }` |

The POST/PUT body now accepts `kind: 'smtp' \| 'slack' \| 'teams'` with the corresponding payload schema.

## 9. UI

Notifiers screen (already exists from Phase 2 for SMTP) gains:
- Type selector when adding: SMTP / Slack / Teams.
- Per-type form fields.
- "Send test" button per row.

## 10. Fanout Logic

In `apps/api/src/services/scan-runner.ts` (or wherever notifiers are constructed):

```ts
const enabled = notifierRepo.list().filter(n => n.enabled);
const notifiers: Notifier[] = enabled.map(n => buildNotifier(n, encryption));
for (const notifier of notifiers) {
  try {
    await notifier.send(digest);
  } catch (err) {
    logger.error(`notifier ${notifier.kind} failed`, err);
    // continue with others
  }
}
```

A failure in one notifier must NOT abort others.

## 11. Testing

- `packages/notifier-slack`: unit tests with `vi.fn()` fetch mock - verify URL, method, headers, payload shape, error handling.
- `packages/notifier-teams`: same.
- API route test for `/test`.
- UI test for type-switcher and test button.

## 12. Risks
- Slack webhook rate limit: 1 message/sec per webhook. Mitigation: digest is one message; not a concern for typical use.
- Teams payload size limit: 28 KB. Mitigation: cap to first 10 comments in card body; link to dashboard for the rest.

## 13. Migration
Existing SMTP configs unaffected. Migration 0005 only required if Phase 2 added a CHECK constraint - flagged in plan as optional based on Phase 2 schema verification.
