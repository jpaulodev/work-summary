# Phase 2 - Web UI + REST API + Auth + Dashboard - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Scope:** Phase 2 of 6 of the `work-summary` product

---

## Assumptions (review and override if any are wrong)

These are decisions I am making by default to avoid blocking. Each can be changed before implementation.

1. **API framework:** Fastify (TS-first, fast, schema-first via zod).
2. **Frontend stack:** Vite + React 18 + TypeScript + react-router-dom v6 + @tanstack/react-query v5 + Tailwind CSS + shadcn/ui (Radix-based primitives).
3. **Auth model:** single-user, session-based (HTTP-only cookie, signed with HMAC). Password stored as argon2id hash in the same SQLite DB. No multi-user in this phase.
4. **Dev experience:** Vite dev server proxies `/api/*` to Fastify on a separate port; production serves the built SPA from Fastify (static middleware).
5. **Token storage:** GitHub/SMTP credentials stored in DB (encrypted at rest with a key derived from a single master passphrase set at install time, fallback to filesystem permissions on the DB).
6. **Config source of truth:** moves from YAML to DB. A one-shot `import-yaml` migration command imports the Phase 1 config.
7. **Comment status states:** `pending | addressed | resolved | snoozed_until:<ts>`. Status changes only via UI (CLI does not change status, only inserts new comments).
8. **Real-time:** plain HTTP polling (5s) in dashboard. No SSE/WS in Phase 2 (defer to a later phase if needed).

---

## 1. Context

Phase 1 produced a CLI that emails a daily digest. Phase 2 adds a web UI for managing sources, tokens, schedules (placeholder), and a dashboard to triage the comments the scanner has already collected. The CLI keeps working unchanged; the new API and UI run as a separate process that shares the SQLite database.

## 2. Goals & Non-Goals

### Goals
- A web UI at `http://localhost:3000` with login, a sources/tokens management screen, an SMTP settings screen, and a dashboard listing pending comments.
- Mark comments as `addressed` / `resolved` / re-open / snooze.
- Filter and search comments by repo, status, matched rules, author.
- Show recent runs (timestamp, duration, found, notified, status).
- Manual "Run scan now" button that triggers a scan in the API process.
- Migration path from YAML config to DB-backed config without losing existing dedup state.

### Non-Goals
- Built-in scheduler (Phase 3).
- JIRA, Slack, Teams (Phases 4-5).
- Reply to comments from UI (Phase 6).
- Multi-user / RBAC.

## 3. Stack & Conventions

- **API:** Fastify v5 + @fastify/cookie + @fastify/static + @fastify/cors (dev only) + zod via fastify-type-provider-zod.
- **Auth:** argon2 (Node bindings) + crypto signed cookies.
- **Crypto:** AES-256-GCM via `node:crypto` for encrypted token columns.
- **Frontend:** Vite, React 18, TypeScript strict, react-router-dom v6, @tanstack/react-query v5, Tailwind CSS v3, shadcn/ui (copy-in components), lucide-react icons, react-hook-form + zod resolver.
- **Test:** vitest for API and frontend; @testing-library/react for components; supertest-style via `fastify.inject` for routes; Playwright for one E2E smoke (login -> dashboard).

## 4. Repository Layout (additions)

```
work-summary/
├── apps/
│   ├── cli/                # unchanged from Phase 1
│   ├── api/                # NEW - Fastify server
│   └── web/                # NEW - Vite + React SPA
└── packages/
    ├── auth/               # NEW - argon2 + session signing + crypto for token columns
    └── config-db/          # NEW - DB-backed config (replaces YAML at runtime)
```

`packages/storage` gains migration 0002 (auth + config + comment status tables).

## 5. Data Model (migration 0002)

```sql
CREATE TABLE app_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),       -- single-user enforcement
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_session (
  id TEXT PRIMARY KEY,                          -- random 32-byte hex
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE source_config (
  source TEXT PRIMARY KEY,                      -- 'github'
  enabled INTEGER NOT NULL DEFAULT 1,
  token_ciphertext TEXT NOT NULL,               -- AES-256-GCM
  token_nonce TEXT NOT NULL,
  config_json TEXT NOT NULL                     -- repos, rules, filters
);

CREATE TABLE notifier_config (
  id TEXT PRIMARY KEY,                          -- 'primary-email'
  type TEXT NOT NULL,                           -- 'smtp'
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,                    -- host/port/from/to/subjectTemplate
  secret_ciphertext TEXT NOT NULL,              -- SMTP user+pass JSON encrypted
  secret_nonce TEXT NOT NULL
);

CREATE TABLE comment_status (
  comment_id TEXT PRIMARY KEY REFERENCES notified_comments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | addressed | resolved | snoozed
  snoozed_until TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_comment_status_status ON comment_status(status);

CREATE TABLE master_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,                           -- for argon2id KDF of the master passphrase
  verifier TEXT NOT NULL                        -- argon2id hash for "is this the right pw"
);
```

Phase 1 columns/tables remain unchanged. `comment_status.comment_id` joins to `notified_comments.id`.

## 6. Architecture

```
                    Browser
                       │
                       ▼
                ┌─────────────┐
                │  Vite dev   │  (dev only) - proxies /api/* to API
                └─────────────┘
                       │
                       ▼ HTTP (cookies)
                ┌─────────────┐
                │  Fastify    │ apps/api
                │  - /api/auth/{login,logout,me}
                │  - /api/sources, /api/notifiers
                │  - /api/comments?status=&repo=&...
                │  - /api/comments/:id/status
                │  - /api/runs
                │  - POST /api/scan (manual trigger)
                │  - GET /  (production: serves dist/web)
                └─────────────┘
                       │
                       ▼
                packages/storage  +  packages/github-source  +  packages/notifiers  +  packages/auth  +  packages/config-db
```

CLI continues to read DB and write `notified_comments` + `runs`. The API reads the same DB and additionally writes `comment_status`. Manual scan from UI calls the same `runScan` function used by the CLI.

## 7. API Surface (REST + JSON)

All routes under `/api`. All responses zod-validated.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/login | no | `{ username, password }` -> sets `ws_session` cookie |
| POST | /api/auth/logout | yes | clears cookie + deletes row |
| GET | /api/auth/me | yes | returns `{ username }` |
| GET | /api/sources | yes | `{ github: { enabled, repos, rules, filters, hasToken } }` (no token returned) |
| PUT | /api/sources/github | yes | updates repos/rules/filters; token only if provided |
| GET | /api/notifiers | yes | list with `hasSecret: bool` |
| PUT | /api/notifiers/:id | yes | updates host/port/from/to/subjectTemplate, optionally secret |
| POST | /api/notifiers/:id/test | yes | sends a test email |
| GET | /api/comments | yes | filters: `status`, `repo`, `rule`, `author`, `since`, `cursor`, `limit` |
| POST | /api/comments/:id/status | yes | `{ status, snoozedUntil?, note? }` |
| GET | /api/runs | yes | latest 50 runs |
| POST | /api/scan | yes | starts an async scan, returns `{ runId }` |
| GET | /api/scan/status | yes | returns `{ running: bool, runId?: number }` |

## 8. UI Screens

1. **Login** - username + password.
2. **Dashboard** (default) - comments list grouped by repo with status filter chips (Pending / Addressed / Resolved / Snoozed / All). Each comment card: repo, container link, author, matched rules, body preview, "Mark addressed" / "Resolve" / "Snooze" actions.
3. **Sources** - github token (write-only), repos list (add/remove), rules toggles, bot filter.
4. **Notifications** - SMTP host/port/from/to/subject; test button.
5. **Runs** - table with last 50 runs and a "Run now" button.
6. **Settings** - change password, change master passphrase (re-encrypts secrets).

## 9. Auth Flow

1. First boot: `work-summary-api` detects no `app_user` and `master_secret`. Prints a one-time bootstrap URL with a 10-minute token; first POST to `/api/auth/bootstrap` with `{ username, password, masterPassphrase }` creates both rows.
2. Subsequent boots: server prompts for `MASTER_PASSPHRASE` env var (or reads from a keychain helper config). Verifies via `master_secret.verifier`. On mismatch, refuses to start.
3. Session cookie: 32-byte random id stored in `app_session`, signed value sent as `ws_session` cookie. HttpOnly, SameSite=Lax, Secure in prod. Expiry: 14 days, sliding.
4. CSRF: API rejects state-changing requests (POST/PUT/DELETE) lacking either `Origin` matching configured origin or a `X-WS-CSRF` header (double-submit pattern).

## 10. Encryption

- `MASTER_PASSPHRASE` -> argon2id KDF -> 32-byte key (`MK`).
- Each secret column stored as `{ ciphertext (base64), nonce (base64) }` using AES-256-GCM with `MK` and a fresh 12-byte nonce. Auth tag included in ciphertext.
- Rotation: changing master passphrase re-encrypts all rows in a single transaction.

## 11. CLI Compatibility

The CLI's `loadConfig` gains a fallback: if `config.yaml` is missing but the DB has `source_config` and `notifier_config`, it loads from the DB instead. The `import-yaml` subcommand reads YAML, writes it to the DB, and renames the file to `config.yaml.imported`.

## 12. Manual Scan Trigger

`POST /api/scan` starts the scan in the API process (not a child). A module-level lock prevents concurrent scans. Status reflected via `/api/scan/status`. On completion the run is visible in `/api/runs` like any cron-triggered scan.

## 13. Testing

- `packages/auth`: unit tests for argon2 verify, AES-GCM encrypt/decrypt, session id signing.
- `packages/config-db`: unit tests for read/write of source_config and notifier_config including secret round-trip.
- `apps/api`: route tests via `fastify.inject`, with an in-memory SQLite. Each route group has happy-path + 401 + 400 cases.
- `apps/web`: component tests for the dashboard list, status toggles, login form. One Playwright smoke: login -> mark addressed -> see it filtered out.
- Coverage targets: auth + config-db >= 90%, API routes >= 80%, web components smoke-level.

## 14. Out-of-Scope Decisions Deferred to Phase 3+

- Scheduling UI is a placeholder in Phase 2 ("Schedules are managed via OS cron until Phase 3").
- No multi-user, no RBAC, no audit log.
- No mobile-specific layout beyond Tailwind responsive defaults.

## 15. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User loses MASTER_PASSPHRASE -> secrets unrecoverable | Bootstrap flow prints recovery instructions; export to `~/.config/work-summary/.master-recovery` (chmod 600) optional |
| SQLite DB locked by CLI + API simultaneously | WAL mode (already on); short transactions; retry on `SQLITE_BUSY` (max 5x, 100ms backoff) |
| Token exposure in API logs | Token never returned in GET; PUT only accepts new value, never echoes |
| Manual scan blocks API event loop | scan runs in a worker_thread or as Promise without awaiting from the request handler |

## 16. Open Questions (non-blocking)

- Should `/api/scan` accept a `repos` filter to scan a subset? (default: all; can add later)
- Should snooze auto-revert to pending when `snoozed_until` passes? (proposed: yes, a small in-API ticker every 60s)
