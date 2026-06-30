# work-summary

Stop losing track of comments that need your reply. **work-summary** scans your GitHub
(and JIRA) activity, finds the PR/issue comments that are actually waiting on *you*, and
surfaces them — as a daily email/Slack/Teams digest, or in a premium web dashboard where
you can triage and reply without leaving the page.

## Features

- **Smart matching** — five rules pick out comments that need you (mentions, PRs you
  authored, threads you replied in, things you're assigned to, requested changes), with a
  bot filter. Each comment is de-duplicated so you're notified once.
- **Sources** — GitHub (PRs + issues) and JIRA (issue comments via JQL), scanned together.
- **Delivery** — email (SMTP), Slack (Block Kit), and Microsoft Teams (Adaptive Card).
  Every enabled channel receives the digest; one failing channel never blocks the others.
- **Two ways to run** — a zero-server **CLI** (great for cron), or the **web dashboard +
  REST API** with login, an in-process scheduler, and one-click triage.
- **Reply from the dashboard** — answer a GitHub or JIRA comment inline; the reply is
  posted upstream and the comment is marked addressed.
- **Secure by default** — all secrets (GitHub/JIRA tokens, SMTP creds, webhook URLs) are
  AES-256-GCM encrypted at rest with an argon2id-derived master key; passwords are argon2id
  hashed; sessions are HttpOnly signed cookies. Tokens are never logged or returned.

## Requirements

- **Node.js 20.x** (use `nvm use 20`). The native modules `better-sqlite3` and `argon2`
  do **not** compile on Node 26 — building on a newer default Node is the most common
  setup failure. CI runs on Node 20 and 22.
- **pnpm** (the repo is a pnpm + turbo monorepo).

```bash
git clone https://github.com/jpaulodev/work-summary.git
cd work-summary
nvm use 20            # important: native modules need Node 20.x
pnpm install
pnpm build
```

---

## Option A — CLI (cron-friendly, email only)

The CLI keeps a local SQLite DB and emails a digest. No server, no login.

```bash
# (optional) link globally; otherwise use: node apps/cli/dist/bin.js <cmd>
cd apps/cli && pnpm link --global && cd ../..

# 1. Write a starter config to ~/.config/work-summary/config.yaml
work-summary init

# 2. Edit the config: set user.githubLogin, sources.github.repos, and your SMTP block.
#    The token/SMTP password are read from env vars referenced in the file.

# 3. Provide secrets via env
export GITHUB_TOKEN=ghp_xxxx          # repo + read:user scopes
export SMTP_USER=me@example.com
export SMTP_PASS=app-password

# 4. Verify config, GitHub auth, SMTP, and the state DB
work-summary doctor

# 5. Scan and send the digest (this is the default command)
work-summary scan
```

Schedule it with cron (the CLI is stateless between runs; the DB handles de-dup):

```
# 8am, 12pm, 5pm on weekdays
0 8,12,17 * * 1-5  /usr/local/bin/work-summary scan --json >> ~/.local/state/work-summary/cron.log 2>&1
```

On macOS prefer `launchd` (`man launchd.plist`). Or skip cron entirely and use the
dashboard's built-in scheduler (Option B).

### CLI commands

- `work-summary init` — write a starter config to `~/.config/work-summary/config.yaml`.
- `work-summary doctor` — validate config, ping GitHub, verify SMTP, open the state DB.
- `work-summary scan` — fetch pending comments and email a digest (default command).
  - `--dry-run` — compute and report but neither send nor mark notified (exits 10).
  - `--json` — JSON-only logs (recommended for cron).
  - `--debug` — verbose debug logging.
- `work-summary import-yaml` — copy your YAML config into the encrypted DB used by the
  web dashboard (one-time bridge if you start on the CLI and move to the UI).

---

## Option B — Web dashboard + API (all features)

This is the full product: login, triage UI, scheduler, JIRA, Slack/Teams, and replies.
Everything is configured **in the UI** — no YAML required.

```bash
# 1. Build everything (if you haven't already)
nvm use 20 && pnpm build

# 2. Required env for the API
export MASTER_PASSPHRASE='a-long-random-passphrase'   # derives the encryption + session key
export GITHUB_LOGIN='your-github-username'            # REQUIRED so matching knows who "you" are
                                                      # (mentions/assignee/PR-author match against this)

# 3. Start the API. In production it also serves the built dashboard from one origin.
NODE_ENV=production node apps/api/dist/bin.js          # -> http://127.0.0.1:3001
```

On first start the API prints a `curl` command to create your login. Run it (or use any
client):

```bash
curl -X POST http://127.0.0.1:3001/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"username":"you","password":"a-strong-password"}'   # password min 8 chars
```

Open **http://127.0.0.1:3001**, log in, then configure everything from the sidebar:

| Screen | What you set up |
| --- | --- |
| **Sources** | Paste a GitHub token (write-only — never shown back), list `owner/repo` entries, toggle the five matching rules, configure the bot filter. |
| **JIRA** (Sources area) | Add a JIRA site (base URL, email, API token), discover and pick projects. Scans then include JIRA issue comments. |
| **Notifications** | Add one or more channels: **Email (SMTP)**, **Slack** (incoming webhook), or **Microsoft Teams** (incoming webhook). Each has a **Send test** button. Every enabled channel receives the digest. |
| **Schedules** | Create cron schedules (with timezone, optional repo filter) so scans run automatically — this replaces external cron. |
| **Dashboard** | Triage matched comments: filter by status (pending / addressed / resolved / snoozed), mark/snooze/reopen, **Reply** inline (posts to GitHub/JIRA and marks the comment addressed), and **Run now** to trigger a scan on demand. |

> The GitHub/JIRA token used for replies must have **write** scope on the repo/issue. A
> reply that fails on a missing scope surfaces a clear banner and leaves the comment's
> status unchanged.

### Development mode

Run the API and the Vite dev server separately (Vite proxies `/api` → `:3001`):

```bash
# terminal 1
export MASTER_PASSPHRASE='dev-passphrase' GITHUB_LOGIN='your-github-username'
node apps/api/dist/bin.js                       # :3001 (omit NODE_ENV=production)

# terminal 2
pnpm --filter @work-summary/web dev             # :5173
```

An end-to-end smoke test lives in [`e2e/`](e2e) (Playwright; run manually against a
seeded DB).

---

## Matching rules

Toggle each per source (UI Sources screen, or `sources.github.rules` in YAML):

| Key                         | Description                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `authorOfPrUnanswered`      | A comment from someone else on a PR I authored, with no reply from me since                |
| `mentioned`                 | A comment that @-mentions my login (word boundary, case insensitive)                       |
| `repliedBeforeThenFollowup` | I commented earlier in the thread; someone followed up after my last comment               |
| `assignee`                  | I am an assignee on the PR/issue and a comment has no reply from me since                  |
| `changesRequested`          | A reviewer left a CHANGES_REQUESTED review on my PR; I have not pushed a commit or replied |

## Environment variables

| Var | Used by | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | CLI | GitHub PAT (`repo` + `read:user`). In the dashboard the token is stored encrypted in the DB instead. |
| `SMTP_USER` / `SMTP_PASS` | CLI | SMTP credentials referenced from the YAML config. |
| `MASTER_PASSPHRASE` | API | Derives the AES-256-GCM master key and session secret. Required to start the API. Use the same value every run. |
| `GITHUB_LOGIN` | API | Your GitHub username — matching uses it to decide what's directed at you. Without it, identity-based rules match nothing. |
| `PORT` | API | API port (default `3001`). |
| `NODE_ENV=production` | API | Also serve the built dashboard from the API origin. |
| `XDG_STATE_HOME` | CLI + API | Override the state dir (default `~/.local/state`); both share `…/work-summary/state.db`. |

## Exit codes (CLI)

| Code | Meaning                              |
| ---: | ------------------------------------ |
|    0 | Success (digest sent or nothing new) |
|    1 | Unexpected error                     |
|    2 | Invalid config                       |
|    3 | GitHub auth failure                  |
|    4 | SMTP failure                         |
|    5 | Storage IO failure                   |
|   10 | Dry-run would-send                   |

## Troubleshooting

- **`better-sqlite3` / `argon2` fail to build (`'climits' file not found`, node-gyp errors)** —
  you're on a too-new Node. Run `nvm use 20` and reinstall: `pnpm install`.
- **`MASTER_PASSPHRASE env var is required to start the API`** — export it before starting
  the API, and use the *same* passphrase each time (it derives the key that decrypts your
  stored secrets).
- **Dashboard scans find nothing even though comments exist** — set `GITHUB_LOGIN`; without
  it the identity rules (mentioned/assignee/PR author) can't match. Also confirm the repo is
  listed and at least one rule is enabled on the Sources screen.
- **`config error: Unresolved environment variables: GITHUB_TOKEN`** (CLI) — export the var.
- **`SmtpError: connect ECONNREFUSED`** — check host/port and outbound SMTP access.
- **`401 Unauthorized` from GitHub** — regenerate the token with `repo` + `read:user`.
- **Reply fails with a "write scope" banner** — the token needs write access to that
  repo/issue; the comment status is intentionally left unchanged.
- **Digest arriving repeatedly** — de-dup is per state DB. Don't delete
  `~/.local/state/work-summary/state.db` unless you want to replay.

## Architecture

Six phases, all shipped (see [`docs/superpowers/specs/`](docs/superpowers/specs) for each
design). The CLI and API share the same `core` matching engine, `storage` (SQLite/WAL),
and source/notifier packages.

```
apps/cli  ->  github-source, jira-source ->  core      apps/api ->  auth, config-db, scheduler,
   |      ->  notifiers (smtp/slack/teams) ->  core        |          sources, notifiers, storage
   |      ->  storage                       ->  core        `->  apps/web (premium React dashboard)
   `->  core
```

## License

MIT.
