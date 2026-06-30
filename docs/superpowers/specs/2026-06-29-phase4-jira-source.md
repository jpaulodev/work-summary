# Phase 4 - JIRA Source Integration - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Scope:** Phase 4 of 6

---

## Assumptions

1. **JIRA Cloud only** (Atlassian-hosted). No on-prem/Data Center support in v1.
2. Auth: **API token + user email** (Basic auth header). No OAuth dance.
3. Filter rule: include comment if the issue's `assignee` is the configured user, OR the issue's custom field `DEVELOPER` (id configurable per project) equals the user.
4. Reuses Phase 1's `Source` interface; produces same `NotifiedComment` shape with `source = 'jira'`.
5. Project selection: user picks one or more projects per JIRA site (multi-site supported).
6. Comment dedup: same SHA-256 fingerprint scheme as GitHub (source + canonical URL + author + body).

---

## 1. Goals
- Scanner pulls comments from JIRA issues where the user is involved (assignee/developer/reporter) and that have unread comments.
- UI lets user manage JIRA sites: URL, email, API token (encrypted), selected projects, custom field id for DEVELOPER.
- Comments appear in the same dashboard as GitHub comments, distinguishable by a JIRA badge.

## 2. Non-Goals
- JIRA Server / Data Center.
- Atlassian Connect app / OAuth.
- Filtering by JQL the user types directly (the built-in filter is sufficient for v1).

## 3. Stack
- HTTP client: `undici` (already pinned in Phase 1, native fetch alternative).
- No SDK - JIRA REST v3 endpoints called directly.

## 4. Data Model (migration 0004)

```sql
-- New: jira_site one row per JIRA Cloud instance
CREATE TABLE jira_site (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,         -- https://acme.atlassian.net
  email TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,  -- AES-256-GCM
  developer_field_id TEXT,        -- e.g. customfield_10101
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE jira_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES jira_site(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,      -- e.g. WS
  project_name TEXT NOT NULL,
  UNIQUE(site_id, project_key)
);

-- Extend notified_comments to track jira issue key
ALTER TABLE notified_comments ADD COLUMN issue_key TEXT;
```

## 5. JIRA Client

`packages/jira-source/src/client.ts`:

```ts
export class JiraClient {
  constructor(opts: { baseUrl: string; email: string; token: string });
  search(jql: string, opts?: { fields?: string[]; startAt?: number; maxResults?: number }):
    Promise<{ issues: JiraIssue[]; total: number; isLast: boolean }>;
  listComments(issueKey: string): Promise<JiraComment[]>;
  myself(): Promise<{ accountId: string; emailAddress: string }>;
}
```

Auth: header `Authorization: Basic base64(email:token)`.

## 6. Filter Logic

For each project on each enabled site:
1. Call `GET /rest/api/3/myself` once to learn the user's `accountId`.
2. Build JQL:
   ```
   project = "<KEY>"
   AND (assignee = currentUser()
        OR reporter = currentUser()
        OR "<developer_field_id>" = currentUser())
   AND updated >= -7d
   ORDER BY updated DESC
   ```
   (`developer_field_id` clause omitted if null.)
3. For each returned issue, list comments updated in the last 7 days.
4. Skip comments authored by the user themselves.
5. Generate fingerprint and run dedup against `notified_comments`.

## 7. JiraSource (implements Source)

```ts
export class JiraSource implements Source {
  readonly name = 'jira';
  constructor(deps: { sites: JiraSiteRow[]; projects: JiraProjectRow[]; encryption: EncryptionService });
  async fetchPendingComments(opts: { since: Date }): Promise<NotifiedCommentInput[]>;
}
```

Mapping JIRA -> NotifiedComment:
- `id` = SHA-256 fingerprint
- `source` = 'jira'
- `repo_or_project` = `${site.baseUrl} :: ${project.key}`
- `issue_key` = issue key (e.g. WS-123)
- `pr_or_issue_url` = `${baseUrl}/browse/${issueKey}?focusedCommentId=${commentId}`
- `comment_url` same as above
- `author` = comment.author.displayName
- `body` = ADF body rendered to plain text via `adfToText()` utility
- `created_at` / `updated_at` = ISO from JIRA payload

## 8. ADF -> Text Conversion

JIRA comment body is Atlassian Document Format (JSON). Implement a small recursive converter `adfToText(doc): string`:
- `paragraph` -> children joined + `\n\n`
- `text` -> `node.text`
- `mention` -> `@<displayName>`
- `hardBreak` -> `\n`
- Unknown nodes -> recurse into children, ignore unknown leaf types.

200-char preview for digest.

## 9. API Surface (additions)

| Method | Path | Notes |
|---|---|---|
| GET | /api/jira/sites | list (token redacted) |
| POST | /api/jira/sites | `{ baseUrl, email, token, developerFieldId? }` - validates by calling `/myself` |
| PUT | /api/jira/sites/:id | update; if token blank, keep existing |
| DELETE | /api/jira/sites/:id | cascades to jira_project |
| GET | /api/jira/sites/:id/projects/discover | live-fetches `/rest/api/3/project/search` and returns list |
| PUT | /api/jira/sites/:id/projects | `{ projectKeys: string[] }` replaces selection |
| GET | /api/jira/sites/:id/fields/discover | live-fetches `/rest/api/3/field` filtered to custom fields named like /develop/i |

## 10. UI

Sources screen gains a tab "JIRA" alongside the existing "GitHub" tab.

JIRA tab:
- "+ Add JIRA site" dialog: base URL, email, API token, "Test connection" button.
- After save, expand to show "Discover projects" multi-select.
- DEVELOPER field id: discover button populates a dropdown of likely custom fields; user confirms.

Dashboard comment cards display a "JIRA" badge with the project key.

## 11. Testing
- Unit: `adfToText`, fingerprint stability, JQL builder.
- Integration: `JiraClient` against mocked fetch (nock-like via `vitest mock`).
- E2E: skipped for JIRA API calls (env-gated optional test).

## 12. Risks
- Rate limits (JIRA Cloud: 10 req/sec per user). Mitigate with 100ms throttle between issue comment calls and exponential backoff on 429.
- Custom field id discovery is best-effort. User can still type the id manually.

## 13. Out-of-band
A migration helper exists if the user wants to import bulk projects from a YAML file (`apps/cli` gains `jira:import-projects`). Not required for the UI flow.
