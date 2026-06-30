# work-summary

Stop losing track of comments that need your reply. **work-summary** scans your GitHub
(and JIRA) activity, finds the PR/issue comments that are actually waiting on _you_, and
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
- **Multi-user** — invite teammates from the dashboard; each person connects their own
  GitHub/JIRA and sees only their own comments, schedules, and runs. The first user is the
  admin.
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

# 2. Configure via a .env file (the API and CLI auto-load it from the repo root)
cp .env.example .env
#    Then edit .env and set at least:
#      MASTER_PASSPHRASE  – long random string; derives the encryption + session key
#      PUBLIC_BASE_URL    – base for OAuth redirects (default http://localhost:3001)
#      PORT / WEB_PORT    – API port (3001) and Vite dev port (5173); change freely
#      GITHUB_OAUTH_CLIENT_ID / _SECRET  – from https://github.com/settings/developers
#                          (callback <PUBLIC_BASE_URL>/api/oauth/github/callback)
#      JIRA_OAUTH_CLIENT_ID / _SECRET    – optional, https://developer.atlassian.com/console
#                          (callback <PUBLIC_BASE_URL>/api/oauth/jira/callback)

# 3. Start the API. In production it also serves the built dashboard from one origin.
NODE_ENV=production node apps/api/dist/bin.js          # -> http://localhost:${PORT:-3001}
```

> Prefer not to use a file? Every value can still be a real environment variable
> (`export MASTER_PASSPHRASE=…`); `.env` is just a convenience and takes precedence when present.

> The dashboard authenticates GitHub via **OAuth** — you connect your account with a
> click; no token is pasted. Your GitHub login (used by the matching rules) is read from
> the OAuth profile, so `GITHUB_LOGIN` is no longer needed for the API.

On first start the API prints a `curl` command to create your login. Run it (or use any
client):

```bash
curl -X POST http://127.0.0.1:3001/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"username":"you","password":"a-strong-password"}'   # password min 8 chars
```

Open **http://127.0.0.1:3001**, log in, then configure everything from the sidebar:

| Screen                  | What you set up                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sources**             | **Connect GitHub** with OAuth (one click — no token pasting), list `owner/repo` entries, toggle the five matching rules, configure the bot filter.                                                                              |
| **JIRA** (Sources area) | **Connect JIRA** with OAuth (Atlassian 3LO), then discover and pick projects. Scans then include JIRA issue comments.                                                                                                           |
| **Notifications**       | Add one or more channels: **Email (SMTP)**, **Slack** (incoming webhook), or **Microsoft Teams** (incoming webhook). Each has a **Send test** button. Every enabled channel receives the digest.                                |
| **Schedules**           | Create cron schedules (with timezone, optional repo filter) so scans run automatically — this replaces external cron.                                                                                                           |
| **Team** (admin only)   | Invite teammates: create an invite, share the link, and they register their own account at `/register?invite=…`. Each member's sources, comments, schedules, and runs are isolated.                                             |
| **Dashboard**           | Triage matched comments: filter by status (pending / addressed / resolved / snoozed), mark/snooze/reopen, **Reply** inline (posts to GitHub/JIRA and marks the comment addressed), and **Run now** to trigger a scan on demand. |

> The GitHub/JIRA token used for replies must have **write** scope on the repo/issue. A
> reply that fails on a missing scope surfaces a clear banner and leaves the comment's
> status unchanged.

### Development mode

Run the API and the Vite dev server separately. In `.env`, set
`PUBLIC_BASE_URL=http://localhost:5173` (OAuth lands on Vite, which proxies `/api` to the
API on `PORT`). The Vite dev server listens on `WEB_PORT` and reads the same root `.env`,
so changing `PORT` / `WEB_PORT` is enough — the proxy follows automatically.

```bash
# terminal 1 — API (omit NODE_ENV=production so Vite serves the SPA)
node apps/api/dist/bin.js                       # :${PORT:-3001}

# terminal 2 — dashboard
pnpm --filter @work-summary/web dev             # :${WEB_PORT:-5173}
```

In dev, register the GitHub OAuth callback as `http://localhost:5173/api/oauth/github/callback`
(Vite proxies it to the API).

An end-to-end smoke test lives in [`e2e/`](e2e) (Playwright; run manually against a
seeded DB).

### Updating / deploying

Database migrations run **automatically when the API starts** — there is no manual
migration command. So picking up new changes is just: pull, rebuild, restart. A
long-running process that is never restarted will keep the old code _and_ the old schema,
which is the usual cause of "it worked on my machine but errors after an update".

On a deploy machine, one command does the whole cycle (pull → install → build → start;
migrations apply on startup):

```bash
./bin/deploy.sh            # git pull, pnpm install, pnpm build, start the API
./bin/deploy.sh --no-pull  # build + start only (skip git pull)
pnpm serve                 # same as ./bin/deploy.sh
```

> Use `./bin/deploy.sh` or `pnpm serve` — **not** `pnpm deploy`, which is a built-in pnpm
> command and errors with `ERR_PNPM_NOTHING_TO_DEPLOY`.

On startup the API prints `applied database migrations: …` when it applies any, so you can
confirm the schema is current. To run it under a process manager, point the manager at
`node apps/api/dist/bin.js` (or `pnpm start`) after a build.

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

Set these in a `.env` file at the repo root (`cp .env.example .env`) — the API and CLI
auto-load it — or export them as real environment variables. See
[`.env.example`](.env.example) for the annotated template.

| Var                                                     | Used by   | Purpose                                                                                                         |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                          | CLI       | GitHub PAT (`repo` + `read:user`). In the dashboard the token is stored encrypted in the DB instead.            |
| `SMTP_USER` / `SMTP_PASS`                               | CLI       | SMTP credentials referenced from the YAML config.                                                               |
| `MASTER_PASSPHRASE`                                     | API       | Derives the AES-256-GCM master key and session secret. Required to start the API. Use the same value every run. |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | API       | GitHub OAuth App credentials for the "Connect GitHub" flow.                                                     |
| `JIRA_OAUTH_CLIENT_ID` / `JIRA_OAUTH_CLIENT_SECRET`     | API       | Atlassian OAuth 2.0 (3LO) credentials for the "Connect JIRA" flow.                                              |
| `PUBLIC_BASE_URL`                                       | API       | Base URL used to build OAuth redirect URIs (default `http://localhost:3001`).                                   |
| `PORT`                                                  | API + web | API port (default `3001`); the Vite dev proxy targets it automatically.                                         |
| `WEB_PORT`                                              | web       | Vite dev-server port (default `5173`).                                                                          |
| `NODE_ENV=production`                                   | API       | Also serve the built dashboard from the API origin.                                                             |
| `XDG_STATE_HOME`                                        | CLI + API | Override the state dir (default `~/.local/state`); both share `…/work-summary/state.db`.                        |

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
  the API, and use the _same_ passphrase each time (it derives the key that decrypts your
  stored secrets).
- **"Connect GitHub" shows "OAuth is not configured"** — set `GITHUB_OAUTH_CLIENT_ID` and
  `GITHUB_OAUTH_CLIENT_SECRET` (and `PUBLIC_BASE_URL`) before starting the API, and make sure
  the OAuth App's callback URL matches `<PUBLIC_BASE_URL>/api/oauth/github/callback`.
- **Dashboard scans find nothing even though comments exist** — connect GitHub on the Sources
  screen (the matching login comes from the OAuth profile), confirm the repo is listed, and
  enable at least one rule.
- **`config error: Unresolved environment variables: GITHUB_TOKEN`** (CLI) — export the var.
- **`SmtpError: connect ECONNREFUSED`** — check host/port and outbound SMTP access.
- **`401 Unauthorized` from GitHub** — regenerate the token with `repo` + `read:user`.
- **Reply fails with a "write scope" banner** — the token needs write access to that
  repo/issue; the comment status is intentionally left unchanged.
- **Digest arriving repeatedly** — de-dup is per state DB. Don't delete
  `~/.local/state/work-summary/state.db` unless you want to replay.

## Architecture

Seven phases, all shipped (see [`docs/superpowers/specs/`](docs/superpowers/specs) for each
design). The CLI and API share the same `core` matching engine, `storage` (SQLite/WAL),
and source/notifier packages; the API adds OAuth (`oauth`) and per-user data isolation.

```
apps/cli  ->  github-source, jira-source ->  core      apps/api ->  auth, oauth, config-db, scheduler,
   |      ->  notifiers (smtp/slack/teams) ->  core        |          sources, notifiers, storage
   |      ->  storage                       ->  core        `->  apps/web (premium React dashboard)
   `->  core
```

Auth model: username/password app login (argon2id) + per-user **OAuth** connections for
GitHub and JIRA. Every per-user table is keyed by `user_id`; admins invite teammates from
the Team screen.

## License

MIT.
