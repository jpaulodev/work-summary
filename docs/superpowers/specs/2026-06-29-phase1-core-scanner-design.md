# Phase 1 - Core Scanner (MVP) - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Author:** @jpaulodev (brainstormed with Copilot CLI)
**Scope:** Phase 1 of 6 of the `work-summary` product

---

## 1. Context

`work-summary` is a personal productivity system that centralizes all the PR/issue comments waiting on me across multiple sources (initially GitHub, later JIRA) and pushes a digest to channels I choose (initially email, later Slack/Teams). The full product roadmap is 6 phases:

1. **Phase 1 (this spec)** - Core Scanner CLI: GitHub source, SMTP notifier, runs via OS cron
2. Phase 2 - Web UI + REST API + auth + dashboard (mark addressed/resolved, manage sources/tokens via UI)
3. Phase 3 - Built-in configurable scheduler (replaces OS cron, supports cron expressions and presets)
4. Phase 4 - JIRA source (custom field `DEVELOPER` filter, project selection)
5. Phase 5 - Multi-channel notifiers (Slack, Teams)
6. Phase 6 - Reply to comments directly from the dashboard

Each phase ships independently and is self-contained. Phase 1's goal is **producing a working daily email digest of pending GitHub comments**, run on demand or via `cron`, with state persisted locally.

## 2. Goals & Non-Goals

### Goals (Phase 1)
- A CLI `work-summary` that, when invoked, scans configured GitHub repos and emails the user a digest of comments awaiting their response.
- Comments dedup'd across runs: the same comment is never emailed twice.
- Five matching rules, all toggle-able via config. "Unanswered by me" means there is no comment authored by `user.githubLogin` chronologically after the candidate comment within the same container (PR or issue) thread:
  - **A.** I'm the PR author and there's an unanswered-by-me comment from someone else
  - **B.** I was @-mentioned in any comment (scoped to the configured repo list)
  - **D.** I commented earlier on the PR/issue and someone followed up after my last comment (i.e., my comment is no longer the latest from me)
  - **E.** I'm an assignee on the PR/issue and there is at least one unanswered-by-me comment in the thread
  - **F.** A reviewer left a "Changes Requested" review on a PR of mine and I have not pushed a new commit or replied to the review since
- Pluggable notifier interface (SMTP first, future Slack/Teams/etc. without refactor).
- Monorepo packages reusable by future phases (API, web UI, JIRA source).
- Clear errors, structured logs, sensible exit codes for cron scripting.

### Non-Goals (Phase 1)
- No web UI, no API, no auth - those are Phase 2.
- No built-in scheduler - uses OS `cron`/`launchd`.
- No JIRA, no Slack, no Teams.
- No "mark as addressed/resolved" feature (no UI to expose it).
- No multi-user support.
- No reply-from-CLI capability.

## 3. Stack & Conventions

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+ (LTS)
- **Package manager:** pnpm with workspaces
- **Build orchestration:** turbo
- **CLI framework:** commander
- **Config validation:** zod
- **GitHub client:** @octokit/rest + @octokit/plugin-throttling
- **Storage:** better-sqlite3 (synchronous, embedded)
- **Email:** nodemailer
- **HTML templating:** eta
- **Logging:** pino (+ pino-pretty for dev)
- **Concurrency:** p-limit
- **Testing:** vitest, msw/node (HTTP mocks), smtp-tester (SMTP mock)
- **Lint/format:** ESLint flat config + Prettier + typescript-eslint
- **CI:** GitHub Actions on Node 20 + 22 matrix

Config lives at `~/.config/work-summary/config.yaml` (override with `--config`). State lives at `~/.local/state/work-summary/state.db` (XDG Base Directory).

## 4. Architecture

### Repository layout

```
work-summary/
├── package.json                 # root, pnpm workspaces config
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .github/workflows/ci.yml
├── docs/superpowers/specs/
├── packages/
│   ├── core/                    # types, matching rules, pure domain (zero IO)
│   ├── github-source/           # Octokit adapter, fetch + normalize
│   ├── notifiers/               # Notifier interface + SMTP adapter
│   └── storage/                 # SQLite, migrations, repositories
└── apps/
    └── cli/                     # commander entry point
```

### Dependency direction

```
apps/cli  ─►  github-source ─►  core
   │      ─►  notifiers     ─►  core
   │      ─►  storage       ─►  core
   └─►  core
```

- `core` is pure: it knows nothing about HTTP, files, SQL, or SMTP.
- Adapters depend only on `core` and their respective external library.
- The CLI app composes everything; no cross-adapter imports.

This isolation means:
- `core` is unit-testable without mocks.
- Adapters can be swapped (e.g., Phase 4 adds `packages/jira-source` implementing the same `Source` interface).
- Phase 2's `apps/api` reuses every package without duplication.

## 5. Components

### 5.1 `packages/core`

Pure domain. Exports:

```ts
export interface PendingComment {
  id: string;                  // stable hash: `${source}:${repo}:${type}:${nativeId}`
  source: 'github';            // 'jira' added in Phase 4
  repo: string;                // "org/repo"
  containerType: 'pr' | 'issue';
  containerNumber: number;
  containerTitle: string;
  containerUrl: string;
  commentId: string;           // native id from GH
  commentUrl: string;
  author: { login: string; isBot: boolean };
  body: string;
  createdAt: string;           // ISO 8601
  matchedRules: MatchRule[];
}

export type MatchRule =
  | 'author_of_pr_unanswered'      // rule A
  | 'mentioned'                    // rule B
  | 'replied_before_then_followup' // rule D
  | 'assignee'                     // rule E
  | 'changes_requested';           // rule F

export interface MatchRulesConfig {
  authorOfPrUnanswered: boolean;
  mentioned: boolean;
  repliedBeforeThenFollowup: boolean;
  assignee: boolean;
  changesRequested: boolean;
}

export interface BotFilterConfig {
  excludeBots: boolean;
  botWhitelist: string[];
}

// Pure function: given raw PR/issue/comments state plus the user, returns matched comments.
export function matchComments(
  context: ScanContext,
  rules: MatchRulesConfig,
  filters: BotFilterConfig,
): PendingComment[];

// Stable id derivation, exported separately so tests can pin behavior.
export function computePendingCommentId(parts: { source: string; repo: string; type: string; nativeId: string }): string;
```

`ScanContext` is the normalized snapshot a source delivers: per-PR/issue payload with all comments, reviews, assignees, requested reviewers, and the user login. `core` neither fetches nor caches; it computes.

### 5.2 `packages/github-source`

```ts
export interface Source {
  readonly id: 'github' | 'jira';
  fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]>;
}

export class GithubSource implements Source { /* ... */ }
```

- Uses Octokit with `throttling` plugin enabled (retries on primary + secondary rate limits).
- For each repo in `opts.repos`, fetches in parallel (bounded by `p-limit`):
  - `GET /repos/{owner}/{repo}/pulls?state=open` - open PRs (with `requested_reviewers`, `assignees`, `user`)
  - `GET /repos/.../pulls/{n}/reviews` - review state including `CHANGES_REQUESTED`
  - `GET /repos/.../issues/{n}/comments` - conversation comments (PR + issue)
  - `GET /repos/.../pulls/{n}/comments` - inline PR review comments
- For mentions (rule B), uses `GET /search/issues?q=mentions:{login}+updated:>={since}+is:open+repo:{r1}+repo:{r2}...` scoped to the configured repos, for efficiency vs. scanning every comment, then enriches with comment endpoints. Closed PRs/issues are intentionally excluded in Phase 1 (a closed thread is rarely awaiting your reply); revisit in Phase 2 if needed.
- Filters by `since` (received from CLI watermark logic).
- Normalizes everything into `PendingComment[]`, sets `author.isBot` from GitHub's `type === 'Bot'` or login suffix `[bot]`.
- Passes normalized snapshot to `core.matchComments()` per container.

### 5.3 `packages/storage`

- `better-sqlite3` instance, synchronous API.
- Migrations versioned in `migrations/*.sql`, executed in order at startup. `schema_version` table tracks applied versions.
- Exports repositories with focused APIs:
  - `commentsRepo.filterUnnotified(comments: PendingComment[]): PendingComment[]`
  - `commentsRepo.markAsNotified(ids: string[]): void`
  - `runsRepo.startRun(): number` (returns runId)
  - `runsRepo.finishRun(id, status, stats): void`
  - `watermarksRepo.get(source, repo): string | null`
  - `watermarksRepo.set(source, repo, isoTimestamp): void`

### 5.4 `packages/notifiers`

```ts
export interface Notifier {
  readonly id: string;
  send(payload: NotificationPayload): Promise<void>;
}

export interface NotificationPayload {
  subject: string;
  comments: PendingComment[];
  generatedAt: string;
}

export class SmtpNotifier implements Notifier {
  constructor(opts: SmtpOptions);
  /* nodemailer-based, HTML body rendered via eta template */
}
```

HTML template structure (regras D, E from question P8): grouped by repo, then by PR/issue, then chronological comments within. Each comment renders as a card with author avatar (GitHub URL), body preview (≤ 280 chars, link to GitHub for full thread), and a "matched because:" tag list.

### 5.5 `apps/cli`

Commands:
- `work-summary init` - writes a starter config to `~/.config/work-summary/config.yaml`, creates state dir, prints next steps.
- `work-summary doctor` - validates config, pings GitHub API (verifies token), opens SMTP connection (verifies creds). Exits non-zero on any failure.
- `work-summary scan` - default; runs the full pipeline (see Data Flow).
  - Flags: `--config <path>`, `--dry-run`, `--json`, `--debug`.

## 6. Data Flow

```
work-summary scan
  │
  1. load config YAML (zod-validated, env vars interpolated)
  2. open SQLite, apply pending migrations
  3. startRun() → runId
  4. for each (source, repo):
       since = watermarksRepo.get(source, repo) ?? now - lookbackDays
       comments = source.fetchPendingComments({ repo, since, login, rules, filters })
  5. allComments = flatten + dedup by id
  6. newComments = commentsRepo.filterUnnotified(allComments)
  7. if newComments.length === 0:
       finishRun('success', stats); exit 0
  8. notifier.send({ subject, comments: newComments, generatedAt })
  9. commentsRepo.markAsNotified(newComments.map(c => c.id))
 10. watermarksRepo.set(source, repo, now) for each successful repo
 11. finishRun('success' | 'partial', stats); exit 0 (or 4 on send failure)
```

Failure between (8) and (9) is the only place where a comment could be re-emailed. That's acceptable; lost emails would be worse.

## 7. Configuration

```yaml
# ~/.config/work-summary/config.yaml
user:
  githubLogin: jpaulodev

sources:
  github:
    token: ${GITHUB_TOKEN}
    repos:
      - org-x/repo-foo
      - org-y/repo-bar
    rules:
      authorOfPrUnanswered: true
      mentioned: true
      repliedBeforeThenFollowup: true
      assignee: true
      changesRequested: true
    filters:
      excludeBots: true
      botWhitelist: []           # logins to keep even when excludeBots=true

scan:
  lookbackDays: 7                # used on first run per (source, repo)
  concurrency: 3                 # parallel repo fetches

notifications:
  - id: primary-email
    type: smtp
    enabled: true
    smtp:
      host: smtp.gmail.com
      port: 587
      secure: false
      user: ${SMTP_USER}
      pass: ${SMTP_PASS}
    from: "Work Summary <me@example.com>"
    to: me@example.com
    subjectTemplate: "[work-summary] {{count}} new comments - {{date}}"
    # Allowed placeholders: {{count}} (integer), {{date}} (YYYY-MM-DD in local TZ)

logging:
  level: info                    # debug | info | warn | error
  file: ~/.local/state/work-summary/scan.log
```

`${VAR}` is interpolated from `process.env` at load time. `doctor` fails fast if any required var is unresolved.

## 8. Data Model

```sql
-- 0001_init.sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE notified_comments (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  container_type TEXT NOT NULL,
  container_number INTEGER NOT NULL,
  comment_native_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  matched_rules TEXT NOT NULL,    -- JSON array
  notified_at TEXT NOT NULL
);
CREATE INDEX idx_notified_repo ON notified_comments(repo);
CREATE INDEX idx_notified_at ON notified_comments(notified_at);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,           -- 'success' | 'partial' | 'failed'
  comments_found INTEGER DEFAULT 0,
  comments_notified INTEGER DEFAULT 0,
  error_message TEXT,
  source_stats TEXT               -- JSON: { repo: { fetched, matched } }
);
CREATE INDEX idx_runs_started ON runs(started_at);

CREATE TABLE source_watermarks (
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (source, repo)
);
```

Notes:
- `notified_comments.id` uses the deterministic hash defined in `core.computePendingCommentId`.
- Watermarks are per `(source, repo)` so adding a new repo doesn't replay history on the old ones.
- `runs.source_stats` is JSON to avoid an extra table for what is purely audit data.
- Phase 2 will add `comment_status` (addressed/resolved) - schema migration 0002 at that point.

## 9. Error Handling

| Category | Exit code | Behavior |
|---|---:|---|
| Invalid config | 2 | Fail fast at boot with zod error pointing to the field |
| GitHub auth (401) | 3 | Clear message, suggest checking `GITHUB_TOKEN` |
| GitHub rate limit exceeded after retries | exit 0 with status=`partial` | Affected repos skipped, others continue |
| Repo 404 / no access | exit 0 with status=`partial` | Warning logged, repo skipped |
| SMTP failure | 4 | Comments NOT marked as notified; next run retries |
| SQLite IO failure | 5 | No retry; clear error |
| Unexpected exception | 1 | Full stack in log |

Octokit throttling plugin handles primary + secondary rate limits with exponential backoff (max 3 retries). HTTP timeouts capped at 30s.

The atomic ordering is strict: `send()` must succeed before `markAsNotified()`. Crash between the two means the next run re-sends; that's preferable to silent loss.

## 10. Logging

- `pino` structured JSON to file (`~/.local/state/work-summary/scan.log`), rotated by size.
- Console output: `pino-pretty` when interactive, plain JSON when `--json` or non-TTY (e.g., cron).
- Every line tagged with `runId` for correlation.
- Tokens never logged. Comment bodies omitted by default; `--debug` opts in.
- Summary line on completion: `✓ 3 new comments found, email sent (runId=42, duration=2.1s)`.

## 11. Testing Strategy

| Package | Approach | Tools |
|---|---|---|
| `core` | Unit tests with fixture-driven matching | vitest; JSON fixtures for each rule scenario |
| `github-source` | Integration tests with mocked HTTP | vitest + msw/node, recorded fixtures |
| `storage` | Integration tests with real SQLite in tmpdir | vitest |
| `notifiers` | Integration with local SMTP capture | vitest + smtp-tester |
| `apps/cli` | E2E smoke tests via spawned subprocess | vitest + child_process |

Coverage targets: `core` ≥ 90%, adapters ≥ 80%, CLI smoke-only.

Clock is injected via dependency injection wherever `now()` is consulted, so time-sensitive logic is deterministic in tests.

CI runs on Node 20 + 22, steps: `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm test` → `pnpm build`. No test depends on the public internet.

## 12. CLI UX Examples

```
$ work-summary init
✓ Wrote config to ~/.config/work-summary/config.yaml
✓ Created state dir at ~/.local/state/work-summary/
Next steps:
  1. Set GITHUB_TOKEN and SMTP_USER/SMTP_PASS env vars
  2. Edit config to list your repos
  3. Run: work-summary doctor

$ work-summary doctor
✓ Config valid
✓ GitHub token authenticated as jpaulodev
✓ SMTP connection OK (smtp.gmail.com:587)
✓ State DB writable at ~/.local/state/work-summary/state.db
All checks passed.

$ work-summary scan
✓ Scanned 2 repos (org-x/repo-foo, org-y/repo-bar)
✓ Found 7 matching comments; 3 new since last run
✓ Email sent to me@example.com
Run id: 42  Duration: 2.1s

$ work-summary scan --dry-run
✓ Would send email with 3 new comments (not marked as notified, no email sent)
Exit 10.
```

## 13. Scheduling (Phase 1)

Out of scope for the binary itself. Documented setup in README:

```
# crontab -e
0 8,12,17 * * 1-5  /usr/local/bin/work-summary scan --json >> ~/.local/state/work-summary/cron.log 2>&1
```

(Phase 3 replaces this with a built-in scheduler driven by UI config.)

## 14. Future-Proofing Decisions

Decisions made in Phase 1 with later phases in mind:

| Decision | Why |
|---|---|
| Monorepo | Phase 2 (api, web) and Phase 4 (jira-source) plug in as new packages without refactor |
| `Source` interface | Phase 4 implements same interface for JIRA |
| `Notifier` interface | Phase 5 implements same interface for Slack/Teams |
| `PendingComment.source` field | Polymorphic from day 1 |
| `runs` audit table | Phase 2 dashboard surfaces history |
| Reserved `comment_status` concept (not in schema yet) | Phase 2 adds the table via migration 0002 |

## 15. GitHub Issues (Epics)

The following epics will be created in `jpaulodev/work-summary` upon spec approval:

- **Epic 1:** Phase 1 - Core Scanner CLI (MVP) - links to this spec
- **Epic 2:** Phase 2 - Web UI + REST API + Auth + Dashboard
- **Epic 3:** Phase 3 - Built-in Configurable Scheduler
- **Epic 4:** Phase 4 - JIRA Source Integration
- **Epic 5:** Phase 5 - Multi-channel Notifiers (Slack, Teams)
- **Epic 6:** Phase 6 - Reply to Comments from Dashboard

Phase 1 will be further decomposed into implementation tasks in the writing-plans step.

## 16. Open Questions for Future Phases (Not Blocking Phase 1)

- Phase 2: session-based or JWT auth? Single hardcoded credential or password file?
- Phase 3: scheduler - node-cron in-process or separate daemon?
- Phase 4: JIRA Cloud only, or also JIRA Server/DC?
- Phase 6: reply via GitHub API requires read+write tokens - UX for token scope upgrade?

These are explicitly deferred and will be brainstormed at the start of each phase.
