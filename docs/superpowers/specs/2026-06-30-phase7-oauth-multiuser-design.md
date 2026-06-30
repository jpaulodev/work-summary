# Phase 7 — OAuth sources + multi-user

**Status:** design approved (proceed autonomously). **Date:** 2026-06-30.

## Goal

Replace the manual GitHub Personal Access Token and JIRA API token with **OAuth**
connections, and turn `work-summary` into a **multi-user** app where each person connects
their own GitHub/JIRA accounts. App login stays username/password (argon2, as today);
OAuth is only for connecting *sources*. New users join by **invite** from an admin; the
first (bootstrap) user is the admin.

## Decisions (from brainstorming)

- App identity = local username/password account. OAuth ≠ app login.
- Sources move to OAuth, **replacing** the pasted token fields:
  - GitHub: **OAuth App** (classic) → user access token that does not expire by default
    (no refresh needed).
  - JIRA: **OAuth 2.0 (3LO)** → Bearer access token + refresh token (1h expiry) against
    `api.atlassian.com`, requires `cloudId` resolution.
- Multi-user with **invite-only** registration; first user is admin.

## Delivery — three shippable sub-phases

Built and merged in order, each its own PR (same workflow as Phases 1–6):

1. **7a — GitHub OAuth** (still single-user): replace the GitHub PAT with a "Connect
   GitHub" flow; derive the login from the OAuth profile.
2. **7b — JIRA OAuth (3LO)**: replace the JIRA email+API-token with OAuth; cloudId + Bearer
   + refresh.
3. **7c — Multi-user + invites**: `user_id` on all per-user data, roles, admin invites,
   data isolation, per-user scans.

The `oauth_connection` table is **multi-user-ready from 7a** (its primary key includes
`user_id`, backfilled to the admin = `1`), so 7c does not have to migrate it.

## Operator-provided configuration (env)

OAuth requires registered apps; the operator creates them and supplies credentials:

| Var | Phase | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 7a | Base URL used to build redirect URIs (default `http://127.0.0.1:3001`). |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | 7a | GitHub OAuth App credentials. |
| `JIRA_OAUTH_CLIENT_ID` / `JIRA_OAUTH_CLIENT_SECRET` | 7b | Atlassian OAuth 2.0 (3LO) app credentials. |

`GITHUB_LOGIN` is **removed** — the login now comes from the OAuth profile.

---

## Shared design — OAuth plumbing (introduced in 7a, reused by 7b)

A new `oauth_connection` table stores every connection, both providers, multi-user-ready:

```sql
CREATE TABLE oauth_connection (
  user_id          INTEGER NOT NULL,
  provider         TEXT    NOT NULL,            -- 'github' | 'jira'
  access_ciphertext  TEXT NOT NULL,
  access_nonce       TEXT NOT NULL,
  refresh_ciphertext TEXT,                      -- null for github (non-expiring)
  refresh_nonce      TEXT,
  expires_at       TEXT,                         -- ISO; null = non-expiring
  account_id       TEXT,                         -- github numeric id / jira accountId
  account_login    TEXT,                         -- github login / jira email
  cloud_id         TEXT,                         -- jira only
  site_url         TEXT,                         -- jira only (https://x.atlassian.net)
  scopes           TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
```

**`packages/oauth`** (new, framework-free, fully unit-testable): pure helpers per provider
with no Fastify/DB coupling.

- `buildAuthorizeUrl(provider, { clientId, redirectUri, state, scopes })` → string.
- `exchangeCodeForToken(provider, { clientId, clientSecret, code, redirectUri }, fetchImpl)`
  → `{ accessToken, refreshToken?, expiresIn? }`.
- `refreshAccessToken(provider, { clientId, clientSecret, refreshToken }, fetchImpl)`
  → same shape (JIRA only).
- `fetchIdentity(provider, accessToken, fetchImpl)` → `{ accountId, login }`
  (+ JIRA: `accessible-resources` → `cloudId`, `siteUrl`).

`fetchImpl` defaults to global `fetch`; injected in tests. Tokens never logged.

**`packages/storage` — `OAuthConnectionRepository`**: `get(userId, provider)`,
`upsert(userId, provider, fields)`, `delete(userId, provider)`. Encrypt/decrypt the
access/refresh tokens via `@work-summary/auth` `encryptSecret`/`decryptSecret` at the
config-db layer (repo stores ciphertext; a thin `config-db` wrapper does crypto), matching
how `source_config` is handled today.

**API routes** `apps/api/src/routes/oauth.ts` (registered under `/api`), all `authed`:

- `GET /api/oauth/:provider/start` → mint random `state`, set a short-lived signed
  HttpOnly cookie `ws_oauth_state` (`provider.state`, HMAC via `sessionSecret`, 10-min
  expiry), 302 to the provider authorize URL.
- `GET /api/oauth/:provider/callback?code&state` → verify the state cookie (CSRF),
  exchange the code, fetch identity, upsert the connection for `req.userId`, clear the
  state cookie, 302 to `PUBLIC_BASE_URL` + `/sources?connected=:provider` (or
  `?oauth_error=...` on failure).
- `GET /api/oauth/connections` → list `{ provider, accountLogin, siteUrl, connectedAt }`
  (never returns tokens).
- `DELETE /api/oauth/:provider` → remove the connection.

Missing client credentials → `GET /start` returns `501 { error: 'oauth-not-configured' }`
so the UI can show "ask your operator to set the env vars."

---

## 7a — GitHub OAuth

**Scope:** GitHub source authenticates via OAuth App instead of a PAT. Single-user still.

- Migration `0007_oauth.sql`: create `oauth_connection`. Make
  `source_config.token_ciphertext` / `token_nonce` **nullable** (GitHub config no longer
  carries a token; repos/rules/filters stay in `config_json`).
- `packages/oauth`: implement GitHub provider — authorize URL
  (`https://github.com/login/oauth/authorize`, scope `repo read:user`), token exchange
  (`https://github.com/login/oauth/access_token`, `Accept: application/json`), identity
  (`GET https://api.github.com/user` → `id`, `login`). GitHub OAuth App tokens do not
  expire by default → `refreshToken`/`expiresIn` absent, `expires_at` null.
- `config-db`: `createSourceConfigRepo` splits token from config — `getGithub()` returns
  `{ enabled, repos, rules, filters }` (no token); a new `getGithubAccessToken()` reads
  the access token from `oauth_connection` (provider=github). `putGithub` no longer takes
  a token.
- `scan-runner.ts`: build the GitHub source from the OAuth access token; set
  `user.githubLogin` from `oauth_connection.account_login` (remove the
  `process.env.GITHUB_LOGIN` read). If no GitHub connection exists, the GitHub source
  contributes nothing (JIRA still runs).
- **Web** `routes/sources.tsx`: remove the PAT password field. Add a **Connect GitHub**
  button (links to `/api/oauth/github/start`) and, when connected, show
  "Connected as @login" + **Disconnect**. Repos / rules / filters unchanged. Read the
  `?connected=github` / `?oauth_error` query param for a toast.
- **Replies** (`routes/replies.ts`): the GitHub reply path uses the OAuth access token
  instead of `getGithub().token`.

**Tests:** `packages/oauth` URL builder + exchange + identity (mock `fetch`); the callback
route (mock token + `/user`), state/CSRF rejection, `501` when unconfigured; updated
`sources`/`replies` API tests (token now sourced from `oauth_connection`); updated web
`sources` test (button instead of token field). Migration test asserts applied
`[1,2,3,4,6,7]`.

**Out of scope for 7a:** JIRA still uses its API token; app is still single-user.

---

## 7b — JIRA OAuth (3LO)

**Scope:** JIRA source authenticates via OAuth 2.0 instead of email+API-token.

- `packages/oauth`: JIRA provider — authorize URL
  (`https://auth.atlassian.com/authorize`, `audience=api.atlassian.com`,
  `response_type=code`, `prompt=consent`, scopes
  `read:jira-work read:jira-user write:jira-work offline_access`), token exchange and
  refresh (`https://auth.atlassian.com/oauth/token`), identity via
  `GET https://api.atlassian.com/oauth/token/accessible-resources` → pick the first
  resource → `cloudId` + `siteUrl` (+ `GET .../myself` for `accountId`). Store
  `refresh_token` + `expires_at`.
- `JiraClient` refactor: accept an auth strategy —
  `{ kind: 'oauth', accessToken, cloudId }` (base URL
  `https://api.atlassian.com/ex/jira/{cloudId}`, header `Bearer`) replacing the Basic
  strategy. Endpoint *paths* (`/rest/api/3/...`) are unchanged.
- `getValidJiraAccessToken(deps, userId, now)` (config-db): if `expires_at` is within a
  60-second skew, call `refreshAccessToken`, persist the rotated tokens, return the fresh
  access token + cloudId. Used by `scan-runner` and the JIRA reply path.
- `jira_site` token columns deprecated (nullable); site identity (`site_url`, `cloud_id`)
  comes from `oauth_connection`. `jira_project` (project selection) and
  `developer_field_id` stay. Project discovery now uses the OAuth client.
- **Web** `components/jira-panel.tsx`: replace email+token fields with **Connect JIRA**;
  after connecting show the site URL + account; project selection unchanged.

**Tests:** JIRA provider helpers (authorize/exchange/refresh/accessible-resources, mock
`fetch`); `JiraClient` Bearer base-URL + header; refresh-on-expiry persistence; reply via
OAuth; updated jira-source + jira-panel tests. Migration `0008_jira_oauth.sql` (nullable
token columns) → applied `[...,8]`.

---

## 7c — Multi-user + invites

**Scope:** isolate all per-user data; invite-based registration; roles; per-user scans.

- Migration `0009_multiuser.sql`:
  - `app_user`: drop `CHECK (id = 1)`; add `role TEXT NOT NULL DEFAULT 'member'`,
    `email TEXT`. Backfill user `1` → `role='admin'`. (SQLite: rebuild the table.)
  - `invite`: `id`, `token` (random, unique), `email` (nullable), `role`, `created_by`,
    `created_at`, `expires_at`, `consumed_by` (nullable), `consumed_at` (nullable).
  - Add `user_id INTEGER NOT NULL DEFAULT 1` to: `source_config` (PK →
    `(user_id, source)`), `notifier_config`, `comment_status`, `schedules`, `jira_site`,
    `notified_comments`, `runs`, `source_watermarks`. Backfill existing rows to `1`.
    (`oauth_connection`, `comment_reply` already keyed appropriately —
    `comment_reply` joins through `notified_comments`.)
- Repositories gain a `userId` parameter and every query filters by it:
  `createSourceConfigRepo(db, key, userId)`, `createNotifierConfigRepo(db, key, userId)`,
  `createCommentsRepo(db, userId)`, `createRunsRepo(db, now, userId)`,
  `createWatermarksRepo(db, userId)`, `ScheduleRepository(db, userId)`,
  `JiraSiteRepository(db, userId)`, `JiraProjectRepository(db, userId)`,
  `OAuthConnectionRepository` (already per-user). All routes pass `req.userId`.
- **Auth/registration:**
  - `adminOnly(handler)` guard (checks `app_user.role = 'admin'`).
  - `POST /api/invites` (admin), `GET /api/invites` (admin), `DELETE /api/invites/:id`
    (admin).
  - `POST /api/auth/register` (public): `{ token, username, password }` → validate an
    unconsumed, unexpired invite, create the user, consume the invite, open a session.
  - `bootstrap.ts`: first user gets `role='admin'`; once a user exists, `/bootstrap`
    keeps returning 409 and registration goes through invites.
- **Scans/schedules:** a scan runs for one user (the requester, or a schedule's owner).
  `triggerScan` takes `userId`; the scheduler runs each schedule as its owning user. The
  single-flight lock becomes per-user.
- **Web:** an admin-only **Team** screen to create/revoke invites (shows the invite link);
  a public **Register** route that consumes `?invite=<token>`. All existing screens now
  operate on the logged-in user's data automatically.

**Tests:** invite create/consume/expiry; `register` happy-path + invalid/expired/used
token; `adminOnly` rejects members; data-isolation tests (user A cannot see user B's
comments/sources/notifiers/schedules); per-user scan; migration backfill →
applied `[...,9]`.

---

## Cross-cutting

- **Security:** OAuth access/refresh tokens AES-256-GCM encrypted at rest; never logged or
  returned by any endpoint. `state` cookie prevents OAuth CSRF. `redirect_uri` is derived
  from `PUBLIC_BASE_URL` (not attacker-controlled). Invite tokens are random and
  single-use. Existing argon2 password + signed-session model is unchanged.
- **Backward compatibility:** migrations backfill all existing data to the admin user
  (`1`); an existing single-user install keeps working, now as the admin. The pasted-token
  path is removed (per the "replace" decision) — operators must connect via OAuth after
  upgrading.
- **README:** documented at the end of each sub-phase (new env vars, "Connect" flow, the
  invite/registration flow).

## Verification (every sub-phase)

Build + test + lint + typecheck + format green on Node 20; local parallel-subagent review
with fixes applied; PR; CI green on Node 20 + 22; merge to `main`.
