# work-summary

Centralize all your pending GitHub PR/issue comments in one daily email digest. Phase 1: CLI + SMTP.

## Install

```bash
# clone
git clone https://github.com/jpaulodev/work-summary.git
cd work-summary

# install + build
pnpm install
pnpm build

# link the CLI globally (optional)
cd apps/cli && pnpm link --global
```

Requires Node.js 20+.

## Quick start

```bash
# 1. Bootstrap config
work-summary init

# 2. Set required env vars
export GITHUB_TOKEN=ghp_xxxx          # repo + read:user scopes
export SMTP_USER=me@example.com
export SMTP_PASS=app-password

# 3. Edit ~/.config/work-summary/config.yaml: list your repos

# 4. Verify everything works
work-summary doctor

# 5. Run a scan
work-summary scan
```

## Commands

- `work-summary init` - write a starter config to `~/.config/work-summary/config.yaml`.
- `work-summary doctor` - validate config, ping GitHub, verify SMTP, open the state DB.
- `work-summary scan` - fetch pending comments and email a digest (default command).
  - `--dry-run` - compute and report but neither send nor mark notified (exits 10).
  - `--json` - JSON-only logs (recommended for cron).
  - `--debug` - verbose debug logging.

## Matching rules

Toggle each in config under `sources.github.rules`:

| Key                         | Description                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `authorOfPrUnanswered`      | A comment from someone else on a PR I authored, with no reply from me since                |
| `mentioned`                 | A comment that @-mentions my login (word boundary, case insensitive)                       |
| `repliedBeforeThenFollowup` | I commented earlier in the thread; someone followed up after my last comment               |
| `assignee`                  | I am an assignee on the PR/issue and a comment has no reply from me since                  |
| `changesRequested`          | A reviewer left a CHANGES_REQUESTED review on my PR; I have not pushed a commit or replied |

## Scheduling with cron

```bash
crontab -e
```

Add a line such as:

```
# 8am, 12pm, 5pm on weekdays
0 8,12,17 * * 1-5  /usr/local/bin/work-summary scan --json >> ~/.local/state/work-summary/cron.log 2>&1
```

For macOS, prefer `launchd` (see `man launchd.plist`).

## Exit codes

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

- **`config error: Unresolved environment variables: GITHUB_TOKEN`** - export the missing var before running.
- **`SmtpError: connect ECONNREFUSED`** - check host/port and that your network allows outbound SMTP.
- **`401 Unauthorized` from GitHub** - regenerate `GITHUB_TOKEN` with `repo` and `read:user` scopes.
- **Emails arriving repeatedly** - the dedup table is per state DB. Do not delete `~/.local/state/work-summary/state.db` unless you want to replay.
- **No comments matched but you expected some** - check that the repo is listed in `sources.github.repos` and that at least one rule is enabled.

## Architecture

See [`docs/superpowers/specs/2026-06-29-phase1-core-scanner-design.md`](docs/superpowers/specs/2026-06-29-phase1-core-scanner-design.md) for the full design.

```
apps/cli  ->  github-source ->  core
   |      ->  notifiers     ->  core
   |      ->  storage       ->  core
   `->  core
```

## Roadmap

Phase 2: Web UI + REST API + auth + dashboard.
Phase 3: built-in scheduler (replaces cron).
Phase 4: JIRA source.
Phase 5: Slack and Teams notifiers.
Phase 6: reply to comments from the dashboard.

Each phase has its own GitHub epic - see issues labeled `epic`.

## License

MIT.
