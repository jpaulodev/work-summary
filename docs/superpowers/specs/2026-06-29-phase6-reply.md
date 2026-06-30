# Phase 6 - Reply to Comments from Dashboard - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Scope:** Phase 6 of 6 (final)

---

## Assumptions

1. Replies are posted **via the same source APIs** that delivered the comment (GitHub REST/GraphQL, JIRA REST v3).
2. Replies require **write-scope tokens**. Read-only tokens are insufficient; UI prompts user to upgrade scope.
3. Reply UX is an **inline expandable composer** on the dashboard comment card (no modal).
4. Replies do NOT support markdown preview in v1 - what you type is what gets sent.
5. Successful reply marks the comment as **`addressed`** automatically (user can still toggle back to `pending`).
6. Reply history is persisted locally so users see what they sent and the source's response id.

---

## 1. Goals
- User clicks "Reply" on a dashboard comment, types a response, hits send.
- App posts the reply through GitHub or JIRA, depending on `comment.source`.
- The local comment status flips to `addressed`; the reply text is stored in a new `comment_reply` table.
- Failed replies surface a clear error and the comment status does not change.

## 2. Non-Goals
- Editing or deleting prior replies.
- Threaded reply rendering (we don't fetch downstream replies after sending).
- Markdown/ADF preview before send.
- Bulk reply.

## 3. Stack
- Reuses `octokit` from `@work-summary/github-source` and `JiraClient` from `@work-summary/jira-source`.
- For JIRA, replies must be sent as ADF. We provide `textToAdf(text: string)` (paragraph + text nodes).

## 4. Data Model (migration 0006)

```sql
CREATE TABLE comment_reply (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id TEXT NOT NULL REFERENCES notified_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_response_id TEXT,
  source_url TEXT
);
CREATE INDEX idx_comment_reply_comment ON comment_reply(comment_id);

-- Track scope requirements (so UI can prompt to upgrade)
ALTER TABLE source_config ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jira_site ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
```

## 5. Reply Adapters

Each source package exports a reply function:

### GitHub

`packages/github-source/src/reply.ts`:

```ts
export interface GithubReplyContext {
  octokit: Octokit;          // built with the source_config token
  commentUrl: string;        // canonical URL stored on the comment
  body: string;
}
export interface GithubReplyResult {
  id: number; url: string;
}
export async function postGithubReply(ctx: GithubReplyContext): Promise<GithubReplyResult>;
```

Implementation parses `commentUrl` to determine the comment type:
- `pulls/N#discussion_r<id>` -> PR review comment reply via `POST /repos/{o}/{r}/pulls/{n}/comments/{cid}/replies`.
- `pulls/N#issuecomment-<id>` or `issues/N#issuecomment-<id>` -> POST new issue comment via `POST /repos/{o}/{r}/issues/{n}/comments`.
- PR review thread comments (URL containing `#pullrequestreview-` or top-of-PR comment) -> same issue-comment endpoint.

### JIRA

`packages/jira-source/src/reply.ts`:

```ts
export interface JiraReplyContext {
  client: JiraClient;
  issueKey: string;
  body: string;             // plain text
}
export interface JiraReplyResult {
  id: string; self: string;
}
export async function postJiraReply(ctx: JiraReplyContext): Promise<JiraReplyResult>;
```

Implementation calls `POST /rest/api/3/issue/{issueKey}/comment` with body wrapped via `textToAdf`.

## 6. Token Scope Detection

On source-config save, the API probes the token:
- GitHub: call `GET /user` and inspect `x-oauth-scopes` header. Write scope = contains `repo` (or `public_repo` for public-only).
- JIRA: API tokens have account-level permissions, not scopes. Probe `POST /rest/api/3/myself/notifications` (a no-op endpoint that requires write) is unreliable. Instead, mark `can_write = true` when the user explicitly checks the "I have write permissions" toggle in the UI.

Both are best-effort. If reply POST fails with 401/403, UI prompts to upgrade scope.

## 7. API Surface (additions)

| Method | Path | Notes |
|---|---|---|
| POST | /api/comments/:id/reply | `{ body: string }` -> posts reply, flips status to addressed, returns reply row |
| GET | /api/comments/:id/replies | list local reply history for the comment |

## 8. UI

Dashboard comment card gains a "Reply" button. Click reveals an inline composer:
- Textarea (auto-resize), char counter, send/cancel buttons.
- On send: optimistic loading state, then green check + reply preview chip.
- On error: red banner with "Token may lack write scope" + link to Sources screen.

The card collapses replies into a "1 reply sent" pill (click to expand and view).

## 9. Reply Flow Sequence

```
[Web] POST /api/comments/<id>/reply { body }
  -> [API] load comment + source config
  -> [API] build adapter (GithubReplyAdapter | JiraReplyAdapter)
  -> [API] adapter.send()
       on success:
         insert comment_reply
         commentStatusRepo.set(id, 'addressed', userId)
         return { reply, status: 'addressed' }
       on 401/403:
         return 400 { error: 'token-write-scope', message }
       on other:
         return 502 { error: 'upstream', message }
```

## 10. Testing

- Unit: `parseGithubCommentUrl` (URL discriminator), `textToAdf`, adapter happy paths with octokit/fetch mocks, error mapping.
- API route test: 401 from upstream returns `token-write-scope`.
- UI test: composer expands, sends, reflects addressed state, error banner appears on simulated failure.
- E2E: dashboard reply -> see "1 reply sent" pill and status change.

## 11. Risks
- GitHub PR review reply requires the parent review comment id which is in the URL fragment. URL formatting drift between API and HTML versions could break parsing - mitigated by unit tests covering all known URL shapes.
- JIRA visibility (private comments) not supported in v1; reply is always public to the issue.

## 12. Done = ?
- User can reply to a GitHub PR comment from the dashboard.
- User can reply to a JIRA comment from the dashboard.
- Failed replies show actionable error messages.
- Reply persists in DB and survives reload.
- Comment auto-marked `addressed`.
