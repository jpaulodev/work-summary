# Phase 2 - Web UI + REST API + Auth + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Ship a web UI for managing sources/notifiers/auth and a dashboard to triage comments collected by the Phase 1 scanner.

**Architecture:** Two new apps (`apps/api` Fastify, `apps/web` Vite+React) sharing the SQLite DB with the CLI via two new packages (`packages/auth`, `packages/config-db`). Storage gains migration 0002 for auth + comment status + DB-backed config.

**Tech Stack:** Fastify 5 + zod, argon2, AES-256-GCM, React 18 + Vite + Tailwind + shadcn/ui + react-query + react-router, vitest + @testing-library + Playwright.

## Global Constraints

- Must not break Phase 1 CLI behavior. CLI must keep scanning and emailing.
- Must run in two processes (CLI as cron + API as long-running) against the same DB. WAL mode and short transactions only.
- Secrets in DB only via `packages/auth` AES-256-GCM helpers - never plaintext columns.
- No em-dashes; use hyphens.
- API never returns or logs raw tokens / passwords / SMTP creds.
- Session cookies: HttpOnly, SameSite=Lax, Secure in production.

---

### Task 1: Storage migration 0002 (auth + status + config tables)

**Files:**
- Create: `packages/storage/migrations/0002_phase2.sql`
- Test: `packages/storage/src/migrate-0002.test.ts`

**Interfaces:**
- Consumes: existing `runMigrations` from Phase 1.
- Produces: new tables `app_user`, `app_session`, `source_config`, `notifier_config`, `comment_status`, `master_secret`. `runMigrations` now applies versions 1 and 2 sequentially.

- [ ] **Step 1: Write migration**

Create `packages/storage/migrations/0002_phase2.sql`:

```sql
CREATE TABLE app_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_session (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE source_config (
  source TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  token_ciphertext TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE notifier_config (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_nonce TEXT NOT NULL
);

CREATE TABLE comment_status (
  comment_id TEXT PRIMARY KEY REFERENCES notified_comments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  snoozed_until TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_comment_status_status ON comment_status(status);

CREATE TABLE master_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL
);
```

- [ ] **Step 2: Write failing test**

Create `packages/storage/src/migrate-0002.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase, runMigrations } from './index.js';

describe('migration 0002', () => {
  it('applies both 0001 and 0002 to a fresh DB', () => {
    const db = openDatabase(':memory:');
    const r = runMigrations(db);
    expect(r.applied).toEqual([1, 2]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['app_user', 'app_session', 'source_config', 'notifier_config', 'comment_status', 'master_secret']) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    expect(runMigrations(db).applied).toEqual([]);
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm --filter @work-summary/storage test`

Expected: PASS. No code change needed: `runMigrations` already iterates `migrations/*.sql` in order.

- [ ] **Step 4: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): migration 0002 (auth, comment_status, config tables)"
```

---

### Task 2: `packages/auth` - argon2 password + AES-GCM secrets + session signer

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/src/index.ts`
- Create: `packages/auth/src/password.ts`
- Create: `packages/auth/src/secrets.ts`
- Create: `packages/auth/src/session.ts`
- Test: `packages/auth/src/password.test.ts`
- Test: `packages/auth/src/secrets.test.ts`
- Test: `packages/auth/src/session.test.ts`

**Interfaces:**
- `hashPassword(plain: string): Promise<string>` (argon2id)
- `verifyPassword(plain: string, hash: string): Promise<boolean>`
- `deriveMasterKey(passphrase: string, salt: Buffer): Promise<Buffer>` (argon2id raw, 32 bytes)
- `encryptSecret(plaintext: string, key: Buffer): { ciphertext: string; nonce: string }` (base64)
- `decryptSecret(ciphertext: string, nonce: string, key: Buffer): string`
- `signSessionId(id: string, secret: Buffer): string` and `verifySessionId(token: string, secret: Buffer): string | null`

- [ ] **Step 1: Package skeleton**

Create `packages/auth/package.json`:

```json
{
  "name": "@work-summary/auth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "argon2": "^0.41.1" },
  "devDependencies": { "typescript": "^5.5.4", "vitest": "^2.0.5" }
}
```

Create `packages/auth/tsconfig.json` mirroring other packages.

- [ ] **Step 2: Password helpers (TDD)**

Create `packages/auth/src/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('verifyPassword returns true for the same plaintext', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
  });
  it('verifyPassword returns false for wrong plaintext', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});
```

Run, verify FAIL. Implement `packages/auth/src/password.ts`:

```ts
import * as argon2 from 'argon2';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
```

Run, verify PASS.

- [ ] **Step 3: Secrets (AES-GCM) TDD**

Create `packages/auth/src/secrets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deriveMasterKey, encryptSecret, decryptSecret } from './secrets.js';

describe('secrets', () => {
  it('encrypts and decrypts with the same key', async () => {
    const salt = randomBytes(16);
    const key = await deriveMasterKey('passphrase', salt);
    const { ciphertext, nonce } = encryptSecret('hello', key);
    expect(decryptSecret(ciphertext, nonce, key)).toBe('hello');
  });
  it('fails to decrypt with a different key', async () => {
    const salt = randomBytes(16);
    const k1 = await deriveMasterKey('a', salt);
    const k2 = await deriveMasterKey('b', salt);
    const { ciphertext, nonce } = encryptSecret('hello', k1);
    expect(() => decryptSecret(ciphertext, nonce, k2)).toThrow();
  });
  it('produces a different nonce each call', () => {
    const key = randomBytes(32);
    const a = encryptSecret('x', key);
    const b = encryptSecret('x', key);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
```

Run, verify FAIL. Implement `packages/auth/src/secrets.ts`:

```ts
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export async function deriveMasterKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    raw: true,
    hashLength: 32,
    timeCost: 3,
    memoryCost: 2 ** 16,
    parallelism: 1,
  }) as Promise<Buffer>;
}

export function encryptSecret(plaintext: string, key: Buffer): { ciphertext: string; nonce: string } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([enc, tag]).toString('base64'), nonce: nonce.toString('base64') };
}

export function decryptSecret(ciphertext: string, nonce: string, key: Buffer): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
```

Run, verify PASS.

- [ ] **Step 4: Session signer TDD**

Create `packages/auth/src/session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signSessionId, verifySessionId } from './session.js';

describe('session signer', () => {
  it('round-trips a valid token', () => {
    const secret = randomBytes(32);
    const t = signSessionId('abc123', secret);
    expect(verifySessionId(t, secret)).toBe('abc123');
  });
  it('rejects a tampered token', () => {
    const secret = randomBytes(32);
    const t = signSessionId('abc123', secret);
    expect(verifySessionId(t.slice(0, -1) + 'X', secret)).toBeNull();
  });
  it('rejects a token signed by a different secret', () => {
    const t = signSessionId('abc', randomBytes(32));
    expect(verifySessionId(t, randomBytes(32))).toBeNull();
  });
});
```

Implement `packages/auth/src/session.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signSessionId(id: string, secret: Buffer): string {
  return `${id}.${hmac(id, secret)}`;
}

export function verifySessionId(token: string, secret: Buffer): string | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(id, secret);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}
```

Create `packages/auth/src/index.ts`:

```ts
export * from './password.js';
export * from './secrets.js';
export * from './session.js';
```

Run all auth tests, verify PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth
git commit -m "feat(auth): password hash, AES-GCM secrets, signed session ids"
```

---

### Task 3: `packages/config-db` - DB-backed source + notifier config

**Files:**
- Create: `packages/config-db/package.json`
- Create: `packages/config-db/tsconfig.json`
- Create: `packages/config-db/src/index.ts`
- Create: `packages/config-db/src/source.ts`
- Create: `packages/config-db/src/notifier.ts`
- Test: `packages/config-db/src/source.test.ts`
- Test: `packages/config-db/src/notifier.test.ts`

**Interfaces:**
- `createSourceConfigRepo(db, key: Buffer): SourceConfigRepo`
  - `getGithub(): { enabled: boolean; token: string; repos: string[]; rules: MatchRulesConfig; filters: BotFilterConfig } | null`
  - `putGithub(input: { enabled?: boolean; token?: string; repos?: string[]; rules?: MatchRulesConfig; filters?: BotFilterConfig }): void` (token optional - keeps existing if absent)
- `createNotifierConfigRepo(db, key: Buffer): NotifierConfigRepo`
  - `list(): Array<{ id, type, enabled, host, port, secure, from, to, subjectTemplate, hasSecret }>` (no secret returned)
  - `get(id): full record including decrypted secret`
  - `put(id, { ...config, secret?: { user, pass } }): void`

- [ ] **Step 1: Package skeleton**

Create `packages/config-db/package.json`:

```json
{
  "name": "@work-summary/config-db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "engines": { "node": ">=20.0.0" },
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run", "lint": "eslint src", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "dependencies": {
    "@work-summary/core": "workspace:*",
    "@work-summary/auth": "workspace:*",
    "@work-summary/storage": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.5.4", "vitest": "^2.0.5" }
}
```

Mirror `tsconfig.json`.

- [ ] **Step 2: Source config repo TDD**

Create `packages/config-db/src/source.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { createSourceConfigRepo } from './source.js';

const key = randomBytes(32);

let db: ReturnType<typeof openDatabase>;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('sourceConfigRepo', () => {
  it('returns null when no config', () => {
    expect(createSourceConfigRepo(db, key).getGithub()).toBeNull();
  });

  it('round-trips github config with encrypted token', () => {
    const repo = createSourceConfigRepo(db, key);
    repo.putGithub({
      enabled: true,
      token: 'ghp_xxx',
      repos: ['org/a'],
      rules: { authorOfPrUnanswered: true, mentioned: true, repliedBeforeThenFollowup: true, assignee: true, changesRequested: true },
      filters: { excludeBots: true, botWhitelist: [] },
    });
    const got = repo.getGithub();
    expect(got?.token).toBe('ghp_xxx');
    expect(got?.repos).toEqual(['org/a']);
  });

  it('preserves token when put without token field', () => {
    const repo = createSourceConfigRepo(db, key);
    repo.putGithub({
      enabled: true, token: 'ghp_xxx', repos: ['org/a'],
      rules: { authorOfPrUnanswered: true, mentioned: true, repliedBeforeThenFollowup: true, assignee: true, changesRequested: true },
      filters: { excludeBots: true, botWhitelist: [] },
    });
    repo.putGithub({ repos: ['org/b'] });
    const got = repo.getGithub();
    expect(got?.token).toBe('ghp_xxx');
    expect(got?.repos).toEqual(['org/b']);
  });
});
```

Run, verify FAIL.

- [ ] **Step 3: Implement source repo**

Create `packages/config-db/src/source.ts`:

```ts
import { encryptSecret, decryptSecret } from '@work-summary/auth';
import type { MatchRulesConfig, BotFilterConfig } from '@work-summary/core';
import type { SqliteDatabase } from '@work-summary/storage';

export interface GithubSourceConfig {
  enabled: boolean;
  token: string;
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

interface ConfigJson {
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

export interface SourceConfigRepo {
  getGithub(): GithubSourceConfig | null;
  putGithub(input: Partial<GithubSourceConfig>): void;
}

export function createSourceConfigRepo(db: SqliteDatabase, key: Buffer): SourceConfigRepo {
  const get = db.prepare('SELECT enabled, token_ciphertext, token_nonce, config_json FROM source_config WHERE source = ?');
  const upsert = db.prepare(
    `INSERT INTO source_config (source, enabled, token_ciphertext, token_nonce, config_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET enabled = excluded.enabled, token_ciphertext = excluded.token_ciphertext,
       token_nonce = excluded.token_nonce, config_json = excluded.config_json`,
  );

  return {
    getGithub() {
      const row = get.get('github') as { enabled: number; token_ciphertext: string; token_nonce: string; config_json: string } | undefined;
      if (!row) return null;
      const cj = JSON.parse(row.config_json) as ConfigJson;
      return {
        enabled: Boolean(row.enabled),
        token: decryptSecret(row.token_ciphertext, row.token_nonce, key),
        repos: cj.repos, rules: cj.rules, filters: cj.filters,
      };
    },
    putGithub(input) {
      const existing = this.getGithub();
      const token = input.token ?? existing?.token;
      if (!token) throw new Error('token required on first put');
      const merged: ConfigJson = {
        repos: input.repos ?? existing?.repos ?? [],
        rules: input.rules ?? existing?.rules ?? { authorOfPrUnanswered: true, mentioned: true, repliedBeforeThenFollowup: true, assignee: true, changesRequested: true },
        filters: input.filters ?? existing?.filters ?? { excludeBots: true, botWhitelist: [] },
      };
      const enc = encryptSecret(token, key);
      upsert.run('github', input.enabled ?? existing?.enabled ?? true ? 1 : 0, enc.ciphertext, enc.nonce, JSON.stringify(merged));
    },
  };
}
```

Run tests, verify PASS.

- [ ] **Step 4: Notifier config repo TDD + implementation**

Create `packages/config-db/src/notifier.test.ts` testing list (no secret), get (decrypts), put (encrypts user+pass), and partial update (preserves secret if not provided). Pattern mirrors source.test.ts.

Implement `packages/config-db/src/notifier.ts`:

```ts
import { encryptSecret, decryptSecret } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

export interface NotifierRecord {
  id: string;
  type: 'smtp';
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
}

export interface NotifierWithSecret extends NotifierRecord {
  user: string;
  pass: string;
}

export interface NotifierListItem extends NotifierRecord {
  hasSecret: boolean;
}

export interface NotifierConfigRepo {
  list(): NotifierListItem[];
  get(id: string): NotifierWithSecret | null;
  put(id: string, input: Partial<NotifierWithSecret> & { type?: 'smtp' }): void;
  delete(id: string): void;
}

interface ConfigJson {
  host: string; port: number; secure: boolean; from: string; to: string; subjectTemplate: string;
}

interface Secret { user: string; pass: string }

export function createNotifierConfigRepo(db: SqliteDatabase, key: Buffer): NotifierConfigRepo {
  const all = db.prepare('SELECT id, type, enabled, config_json, secret_ciphertext FROM notifier_config');
  const getOne = db.prepare('SELECT id, type, enabled, config_json, secret_ciphertext, secret_nonce FROM notifier_config WHERE id = ?');
  const upsert = db.prepare(
    `INSERT INTO notifier_config (id, type, enabled, config_json, secret_ciphertext, secret_nonce)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET type = excluded.type, enabled = excluded.enabled,
       config_json = excluded.config_json, secret_ciphertext = excluded.secret_ciphertext, secret_nonce = excluded.secret_nonce`,
  );
  const del = db.prepare('DELETE FROM notifier_config WHERE id = ?');

  return {
    list() {
      const rows = all.all() as Array<{ id: string; type: string; enabled: number; config_json: string; secret_ciphertext: string }>;
      return rows.map((r) => {
        const c = JSON.parse(r.config_json) as ConfigJson;
        return { id: r.id, type: 'smtp', enabled: Boolean(r.enabled), ...c, hasSecret: r.secret_ciphertext.length > 0 };
      });
    },
    get(id) {
      const r = getOne.get(id) as { id: string; type: string; enabled: number; config_json: string; secret_ciphertext: string; secret_nonce: string } | undefined;
      if (!r) return null;
      const c = JSON.parse(r.config_json) as ConfigJson;
      const s = JSON.parse(decryptSecret(r.secret_ciphertext, r.secret_nonce, key)) as Secret;
      return { id: r.id, type: 'smtp', enabled: Boolean(r.enabled), ...c, user: s.user, pass: s.pass };
    },
    put(id, input) {
      const existing = this.get(id);
      const cfg: ConfigJson = {
        host: input.host ?? existing?.host ?? '',
        port: input.port ?? existing?.port ?? 587,
        secure: input.secure ?? existing?.secure ?? false,
        from: input.from ?? existing?.from ?? '',
        to: input.to ?? existing?.to ?? '',
        subjectTemplate: input.subjectTemplate ?? existing?.subjectTemplate ?? '[work-summary] {{count}} - {{date}}',
      };
      const secret: Secret = { user: input.user ?? existing?.user ?? '', pass: input.pass ?? existing?.pass ?? '' };
      const enc = encryptSecret(JSON.stringify(secret), key);
      upsert.run(id, 'smtp', (input.enabled ?? existing?.enabled ?? true) ? 1 : 0, JSON.stringify(cfg), enc.ciphertext, enc.nonce);
    },
    delete(id) { del.run(id); },
  };
}
```

Create `packages/config-db/src/index.ts`:

```ts
export { createSourceConfigRepo } from './source.js';
export type { SourceConfigRepo, GithubSourceConfig } from './source.js';
export { createNotifierConfigRepo } from './notifier.js';
export type { NotifierConfigRepo, NotifierRecord, NotifierWithSecret, NotifierListItem } from './notifier.js';
```

Run all tests, verify PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config-db
git commit -m "feat(config-db): DB-backed source + notifier config with encrypted secrets"
```

---

### Task 4: `apps/api` skeleton + bootstrap + auth routes

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`
- Create: `apps/api/src/bin.ts`, `src/server.ts`
- Create: `apps/api/src/master-key.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/bootstrap.ts`
- Create: `apps/api/src/plugins/auth-guard.ts`
- Test: `apps/api/src/routes/auth.test.ts`
- Test: `apps/api/src/routes/bootstrap.test.ts`

**Interfaces:**
- `buildServer(deps: ServerDeps): FastifyInstance` where `ServerDeps = { db; masterKey: Buffer; sessionSecret: Buffer; now: () => Date }`.
- `loadOrPromptMasterKey(): Promise<Buffer>` reads `MASTER_PASSPHRASE` env, derives via `deriveMasterKey` against `master_secret.salt`, verifies against `master_secret.verifier`.

- [ ] **Step 1: Package skeleton**

Create `apps/api/package.json`:

```json
{
  "name": "@work-summary/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/server.js",
  "bin": { "work-summary-api": "./dist/bin.js" },
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/bin.js",
    "test": "vitest run",
    "dev": "tsx src/bin.ts",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@work-summary/auth": "workspace:*",
    "@work-summary/config-db": "workspace:*",
    "@work-summary/core": "workspace:*",
    "@work-summary/github-source": "workspace:*",
    "@work-summary/notifiers": "workspace:*",
    "@work-summary/storage": "workspace:*",
    "@fastify/cookie": "^10.0.1",
    "@fastify/cors": "^10.0.1",
    "@fastify/static": "^8.0.1",
    "fastify": "^5.0.0",
    "fastify-type-provider-zod": "^4.0.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Master key loader TDD**

Test: derives key from passphrase, verifies against stored argon2 verifier; throws on mismatch. Bootstrap creates `master_secret` row when missing.

Implement `apps/api/src/master-key.ts`:

```ts
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { deriveMasterKey } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

export async function bootstrapMasterSecret(db: SqliteDatabase, passphrase: string): Promise<Buffer> {
  const salt = randomBytes(16);
  const verifier = await argon2.hash(passphrase, { type: argon2.argon2id });
  db.prepare('INSERT INTO master_secret (id, salt, verifier) VALUES (1, ?, ?)').run(salt.toString('base64'), verifier);
  return deriveMasterKey(passphrase, salt);
}

export async function loadMasterKey(db: SqliteDatabase, passphrase: string): Promise<Buffer> {
  const row = db.prepare('SELECT salt, verifier FROM master_secret WHERE id = 1').get() as { salt: string; verifier: string } | undefined;
  if (!row) throw new Error('Master secret not bootstrapped');
  const ok = await argon2.verify(row.verifier, passphrase);
  if (!ok) throw new Error('Invalid master passphrase');
  return deriveMasterKey(passphrase, Buffer.from(row.salt, 'base64'));
}

export function hasMasterSecret(db: SqliteDatabase): boolean {
  return Boolean(db.prepare('SELECT 1 FROM master_secret WHERE id = 1').get());
}
```

- [ ] **Step 3: Auth guard plugin**

Create `apps/api/src/plugins/auth-guard.ts`:

```ts
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifySessionId } from '@work-summary/auth';

declare module 'fastify' {
  interface FastifyRequest { userId?: number }
}

export interface AuthGuardOptions { sessionSecret: Buffer }

async function plugin(app: FastifyInstance, opts: AuthGuardOptions) {
  app.decorateRequest('userId', undefined);
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const cookie = req.cookies['ws_session'];
    if (!cookie) return;
    const id = verifySessionId(cookie, opts.sessionSecret);
    if (!id) return;
    const row = (req.server as unknown as { db: import('@work-summary/storage').SqliteDatabase }).db
      .prepare('SELECT user_id, expires_at FROM app_session WHERE id = ?').get(id) as { user_id: number; expires_at: string } | undefined;
    if (!row) return;
    if (new Date(row.expires_at).getTime() < Date.now()) return;
    req.userId = row.user_id;
  });
}

export default fp(plugin);
```

- [ ] **Step 4: Bootstrap and auth routes**

Implement `apps/api/src/routes/bootstrap.ts` (POST `/api/auth/bootstrap` - one-time, refuses if `app_user` exists) and `apps/api/src/routes/auth.ts` (login, logout, me).

Tests via `fastify.inject`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../server.js';
import { openDatabase, runMigrations } from '@work-summary/storage';
import { randomBytes } from 'node:crypto';

let app: Awaited<ReturnType<typeof buildServer>>;
beforeEach(async () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  app = await buildServer({ db, masterKey: randomBytes(32), sessionSecret: randomBytes(32), now: () => new Date() });
});

describe('auth', () => {
  it('bootstrap creates user when none exists', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'me', password: 'pw1234567' } });
    expect(res.statusCode).toBe(201);
  });
  it('bootstrap refuses second call', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'me', password: 'pw1234567' } });
    const res = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'me', password: 'pw1234567' } });
    expect(res.statusCode).toBe(409);
  });
  it('login sets cookie and /me returns user', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'me', password: 'pw1234567' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'me', password: 'pw1234567' } });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie! } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ username: 'me' });
  });
  it('/me 401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
```

Full implementation of `server.ts`, `routes/auth.ts`, `routes/bootstrap.ts`:

```ts
// apps/api/src/server.ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import authGuard from './plugins/auth-guard.js';
import authRoutes from './routes/auth.js';
import bootstrapRoutes from './routes/bootstrap.js';
import type { SqliteDatabase } from '@work-summary/storage';

export interface ServerDeps {
  db: SqliteDatabase;
  masterKey: Buffer;
  sessionSecret: Buffer;
  now: () => Date;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('db', deps.db);
  app.decorate('masterKey', deps.masterKey);
  app.decorate('sessionSecret', deps.sessionSecret);
  app.decorate('now', deps.now);
  await app.register(cookie);
  await app.register(authGuard, { sessionSecret: deps.sessionSecret });
  await app.register(bootstrapRoutes, { prefix: '/api/auth' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: SqliteDatabase;
    masterKey: Buffer;
    sessionSecret: Buffer;
    now: () => Date;
  }
}
```

```ts
// apps/api/src/routes/bootstrap.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '@work-summary/auth';

const BodySchema = z.object({ username: z.string().min(1), password: z.string().min(8) });

export default async function (app: FastifyInstance) {
  app.post('/bootstrap', async (req, reply) => {
    const body = BodySchema.parse(req.body);
    const exists = app.db.prepare('SELECT 1 FROM app_user WHERE id = 1').get();
    if (exists) return reply.code(409).send({ error: 'Already bootstrapped' });
    const hash = await hashPassword(body.password);
    app.db.prepare('INSERT INTO app_user (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run(body.username, hash, app.now().toISOString());
    return reply.code(201).send({ ok: true });
  });
}
```

```ts
// apps/api/src/routes/auth.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { verifyPassword, signSessionId } from '@work-summary/auth';

const LoginSchema = z.object({ username: z.string(), password: z.string() });

export default async function (app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const row = app.db.prepare('SELECT id, password_hash FROM app_user WHERE username = ?').get(body.username) as { id: number; password_hash: string } | undefined;
    if (!row) return reply.code(401).send({ error: 'invalid' });
    if (!(await verifyPassword(body.password, row.password_hash))) return reply.code(401).send({ error: 'invalid' });
    const sid = randomBytes(32).toString('hex');
    const expires = new Date(app.now().getTime() + 14 * 24 * 60 * 60 * 1000);
    app.db.prepare('INSERT INTO app_session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sid, row.id, app.now().toISOString(), expires.toISOString());
    reply.setCookie('ws_session', signSessionId(sid, app.sessionSecret), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires, path: '/',
    });
    return reply.send({ ok: true });
  });

  app.post('/logout', async (req, reply) => {
    const cookie = req.cookies['ws_session'];
    if (cookie) {
      const id = cookie.split('.')[0];
      if (id) app.db.prepare('DELETE FROM app_session WHERE id = ?').run(id);
    }
    reply.clearCookie('ws_session', { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/me', async (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'unauthenticated' });
    const row = app.db.prepare('SELECT username FROM app_user WHERE id = ?').get(req.userId) as { username: string } | undefined;
    return reply.send({ username: row?.username });
  });
}
```

Run tests, verify PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): Fastify server + bootstrap + login/logout/me + auth guard"
```

---

### Task 5: API routes for sources, notifiers, comments, runs, scan

**Files:**
- Create: `apps/api/src/routes/sources.ts`
- Create: `apps/api/src/routes/notifiers.ts`
- Create: `apps/api/src/routes/comments.ts`
- Create: `apps/api/src/routes/runs.ts`
- Create: `apps/api/src/routes/scan.ts`
- Create: `apps/api/src/scan-runner.ts`
- Modify: `apps/api/src/server.ts` (register routes)
- Test: one `.test.ts` per route file

**Interfaces:**
- All routes require `req.userId` (else 401).
- `scan-runner.ts` exports `triggerScan(deps): Promise<{ runId: number }>` with an in-memory single-flight lock (rejects with 409 when already running).
- `comments` route returns `{ items: [...], nextCursor: string | null }` with cursor based on `notified_at` desc.

- [ ] **Step 1: Define each route handler with zod schemas**

Implement each route to back the API table in spec section 7. Pattern (sources):

```ts
// apps/api/src/routes/sources.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSourceConfigRepo } from '@work-summary/config-db';

const PutSchema = z.object({
  enabled: z.boolean().optional(),
  token: z.string().min(1).optional(),
  repos: z.array(z.string()).optional(),
  rules: z.object({
    authorOfPrUnanswered: z.boolean(),
    mentioned: z.boolean(),
    repliedBeforeThenFollowup: z.boolean(),
    assignee: z.boolean(),
    changesRequested: z.boolean(),
  }).optional(),
  filters: z.object({ excludeBots: z.boolean(), botWhitelist: z.array(z.string()) }).optional(),
});

export default async function (app: FastifyInstance) {
  const requireAuth = (req: { userId?: number }) => { if (!req.userId) throw app.httpErrors.unauthorized(); };

  app.get('/sources', async (req, reply) => {
    if (!req.userId) return reply.code(401).send();
    const repo = createSourceConfigRepo(app.db, app.masterKey);
    const g = repo.getGithub();
    return { github: g ? { enabled: g.enabled, repos: g.repos, rules: g.rules, filters: g.filters, hasToken: true } : null };
  });

  app.put('/sources/github', async (req, reply) => {
    if (!req.userId) return reply.code(401).send();
    const body = PutSchema.parse(req.body);
    createSourceConfigRepo(app.db, app.masterKey).putGithub(body);
    return { ok: true };
  });
}
```

`notifiers.ts` (similar shape: GET list, PUT one, POST /:id/test that constructs `SmtpNotifier` and calls `.verify()`).

`comments.ts`:

```ts
// LIMIT 50 per page, cursor = notified_at of last item
app.get('/comments', async (req, reply) => {
  if (!req.userId) return reply.code(401).send();
  const Q = z.object({
    status: z.enum(['pending','addressed','resolved','snoozed','all']).default('all'),
    repo: z.string().optional(),
    rule: z.string().optional(),
    author: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  });
  const q = Q.parse(req.query);
  const wheres: string[] = []; const params: unknown[] = [];
  if (q.repo) { wheres.push('nc.repo = ?'); params.push(q.repo); }
  if (q.author) { wheres.push('nc.author_login = ?'); params.push(q.author); }
  if (q.rule) { wheres.push('nc.matched_rules LIKE ?'); params.push(`%${q.rule}%`); }
  if (q.status !== 'all') { wheres.push("COALESCE(cs.status,'pending') = ?"); params.push(q.status); }
  if (q.cursor) { wheres.push('nc.notified_at < ?'); params.push(q.cursor); }
  const sql = `SELECT nc.*, COALESCE(cs.status,'pending') status, cs.note, cs.snoozed_until
    FROM notified_comments nc LEFT JOIN comment_status cs ON cs.comment_id = nc.id
    ${wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''}
    ORDER BY nc.notified_at DESC LIMIT ?`;
  params.push(q.limit + 1);
  const rows = app.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const hasMore = rows.length > q.limit;
  const items = rows.slice(0, q.limit);
  return { items, nextCursor: hasMore ? items.at(-1)?.notified_at as string : null };
});

app.post('/comments/:id/status', async (req, reply) => {
  if (!req.userId) return reply.code(401).send();
  const params = z.object({ id: z.string() }).parse(req.params);
  const body = z.object({
    status: z.enum(['pending','addressed','resolved','snoozed']),
    snoozedUntil: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  app.db.prepare(`INSERT INTO comment_status (comment_id, status, snoozed_until, note, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(comment_id) DO UPDATE SET status=excluded.status,
      snoozed_until=excluded.snoozed_until, note=excluded.note, updated_at=excluded.updated_at`)
    .run(params.id, body.status, body.snoozedUntil ?? null, body.note ?? null, app.now().toISOString());
  return { ok: true };
});
```

`runs.ts`: GET returns last 50 from `runs` table.

`scan.ts`:

```ts
import { triggerScan, scanStatus } from '../scan-runner.js';
app.post('/scan', async (req, reply) => {
  if (!req.userId) return reply.code(401).send();
  try {
    const { runId } = await triggerScan(app);
    return { runId };
  } catch (err) {
    if (err instanceof Error && err.message === 'already-running') return reply.code(409).send({ error: 'already-running' });
    throw err;
  }
});
app.get('/scan/status', async (req, reply) => {
  if (!req.userId) return reply.code(401).send();
  return scanStatus();
});
```

`scan-runner.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { runScan } from '@work-summary/cli';
import { createOctokit, GithubSource } from '@work-summary/github-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import { createCommentsRepo, createRunsRepo, createWatermarksRepo } from '@work-summary/storage';
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import pino from 'pino';

let running = false;
let lastRunId: number | undefined;

export function scanStatus() { return { running, runId: lastRunId }; }

export async function triggerScan(app: FastifyInstance): Promise<{ runId: number }> {
  if (running) throw new Error('already-running');
  running = true;
  try {
    const src = createSourceConfigRepo(app.db, app.masterKey);
    const notif = createNotifierConfigRepo(app.db, app.masterKey);
    const gh = src.getGithub();
    if (!gh) throw new Error('github not configured');
    const n = notif.list().find((x) => x.enabled);
    if (!n) throw new Error('no enabled notifier');
    const full = notif.get(n.id);
    if (!full) throw new Error('notifier missing');
    const config = {
      user: { githubLogin: process.env.GITHUB_LOGIN ?? '' },
      sources: { github: { token: gh.token, repos: gh.repos, rules: gh.rules, filters: gh.filters } },
      scan: { lookbackDays: 7, concurrency: 3 },
      notifications: [{ id: full.id, type: 'smtp' as const, enabled: true,
        smtp: { host: full.host, port: full.port, secure: full.secure, user: full.user, pass: full.pass },
        from: full.from, to: full.to, subjectTemplate: full.subjectTemplate }],
      logging: { level: 'info' as const, file: '/tmp/api-scan.log' },
    };
    const r = await runScan({
      config,
      deps: {
        db: app.db,
        commentsRepo: createCommentsRepo(app.db),
        runsRepo: createRunsRepo(app.db, () => new Date()),
        watermarksRepo: createWatermarksRepo(app.db),
        source: new GithubSource(createOctokit({ token: gh.token })),
        notifier: new SmtpNotifier({ host: full.host, port: full.port, secure: full.secure, user: full.user, pass: full.pass, from: full.from, to: full.to }),
        logger: pino({ level: 'info' }),
      },
      dryRun: false,
      now: () => new Date(),
    });
    lastRunId = r.newComments;
    return { runId: lastRunId };
  } finally {
    running = false;
  }
}
```

Note: `runScan` returns `{ exitCode; newComments }` - if you need actual run ID, expose it from `runScan` (modify Phase 1 task 25 signature) or query `MAX(id) FROM runs`. Adjust both during implementation.

- [ ] **Step 2: One test per route group**

Write `comments.test.ts`, `sources.test.ts`, `notifiers.test.ts`, `runs.test.ts`, `scan.test.ts` covering: 401 without cookie, happy path, validation 400. Use `fastify.inject` + an authed cookie helper.

- [ ] **Step 3: Run all api tests, verify PASS**

Run: `pnpm --filter @work-summary/api test`

- [ ] **Step 4: Commit**

```bash
git add apps/api
git commit -m "feat(api): sources, notifiers, comments, runs, scan routes"
```

---

### Task 6: `apps/web` skeleton (Vite + React + Tailwind + shadcn/ui + react-query)

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`
- Create: `apps/web/index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `apps/web/tailwind.config.ts`, `postcss.config.cjs`, `src/index.css`
- Create: `apps/web/src/lib/api.ts` (typed fetch wrapper)
- Create: `apps/web/src/lib/query-client.ts`
- Create: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `card.tsx` (shadcn)
- Create: `apps/web/src/routes/login.tsx` placeholder

**Interfaces:**
- `api.get/post/put<T>(path, body?): Promise<T>` - always includes credentials; throws `ApiError` on non-2xx.
- App mounts `<RouterProvider>` with placeholder `/login` route.

- [ ] **Step 1: Package + tooling**

Create `apps/web/package.json`:

```json
{
  "name": "@work-summary/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -b --emitDeclarationOnly false"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.56.0",
    "lucide-react": "^0.445.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.53.0",
    "react-router-dom": "^6.26.2",
    "zod": "^3.23.8",
    "@hookform/resolvers": "^3.9.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.45",
    "tailwindcss": "^3.4.10",
    "typescript": "^5.5.4",
    "vite": "^5.4.5",
    "vitest": "^2.0.5"
  }
}
```

Create `vite.config.ts` with `react()` plugin and `server.proxy = { '/api': 'http://localhost:3001' }`.

Create `tailwind.config.ts` scanning `./src/**/*.{ts,tsx}`. Add Tailwind directives to `src/index.css`.

- [ ] **Step 2: API client**

`apps/web/src/lib/api.ts`:

```ts
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = await res.text(); }
    throw new ApiError(res.status, `${method} ${path} -> ${res.status}`, parsed);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};
```

- [ ] **Step 3: Bootstrap, query client, router**

Create `src/lib/query-client.ts` exporting `new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } })`.

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import Login from './routes/login';
import './index.css';

const router = createBrowserRouter([{ path: '/login', element: <Login /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

Create shadcn primitives manually for `Button`, `Input`, `Card`.

- [ ] **Step 4: Run dev server smoke**

Run: `pnpm --filter @work-summary/web dev` and curl `http://localhost:5173/login` -> 200.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): Vite+React+Tailwind+shadcn+react-query skeleton"
```

---

### Task 7: Login + auth context + protected routes

**Files:**
- Modify: `apps/web/src/routes/login.tsx`
- Create: `apps/web/src/routes/layout.tsx` (protected shell with nav)
- Create: `apps/web/src/lib/auth.ts` (`useMe`, `useLogin`, `useLogout`)
- Create: `apps/web/src/routes/login.test.tsx`

**Interfaces:**
- `useMe()` returns `{ data: { username }, isLoading, error }` via `api.get('/auth/me')`.
- `useLogin()` returns a mutation that POSTs `/auth/login` and invalidates `me`.
- `<Layout>` redirects to `/login` if `useMe()` errors with 401.

- [ ] **Step 1: Implement auth hooks and login form (TDD)**

Test (Vitest + jsdom):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Login from './login';

describe('Login', () => {
  it('submits credentials and shows success', async () => {
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (String(url).endsWith('/api/auth/login')) return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      if (String(url).endsWith('/api/auth/me')) return Promise.resolve(new Response(JSON.stringify({ username: 'me' }), { status: 200 }));
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Login /></MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'me' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw1234567' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/login'), expect.any(Object)));
  });
});
```

Implement `login.tsx` using `react-hook-form` + `zodResolver`, on success navigate to `/`.

- [ ] **Step 2: Protected layout**

`layout.tsx` uses `useMe()`; if error -> `<Navigate to="/login" />`. Otherwise renders `<nav>` (Dashboard, Sources, Notifications, Runs, Settings) + `<Outlet />`.

- [ ] **Step 3: Wire router**

In `main.tsx` make the root route the layout with children: dashboard placeholder, sources placeholder, etc. (full screens come in Tasks 8-10).

- [ ] **Step 4: Run tests, verify PASS, commit**

```bash
pnpm --filter @work-summary/web test
git add apps/web
git commit -m "feat(web): login + auth hooks + protected layout"
```

---

### Task 8: Dashboard - list, filters, status actions

**Files:**
- Create: `apps/web/src/routes/dashboard.tsx`
- Create: `apps/web/src/components/comment-card.tsx`
- Create: `apps/web/src/components/status-filter.tsx`
- Create: `apps/web/src/lib/comments.ts` (hooks: `useComments`, `useUpdateStatus`)
- Test: `apps/web/src/components/comment-card.test.tsx`
- Test: `apps/web/src/routes/dashboard.test.tsx`

**Interfaces:**
- `useComments(filters: { status?; repo?; rule?; author?; cursor? }): UseQueryResult<{ items: CommentRow[]; nextCursor: string | null }>`.
- `useUpdateStatus(): UseMutationResult` posts `/comments/:id/status`, optimistically updates the cached list.
- `<CommentCard comment={...} onStatusChange={fn} />` renders title, link, author, rules, body, 3 action buttons.

- [ ] **Step 1: Hooks + status filter chips**

Implement `lib/comments.ts` with `useInfiniteQuery` for cursor pagination.

- [ ] **Step 2: Component tests for `<CommentCard>`**

```tsx
it('renders comment fields and triggers callback on Mark Addressed', async () => {
  const onChange = vi.fn();
  render(<CommentCard comment={sample()} onStatusChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /addressed/i }));
  expect(onChange).toHaveBeenCalledWith('addressed');
});
```

- [ ] **Step 3: Implement `<Dashboard>` with virtualized-ish chunked render (50 per page, "Load more")**

Run all web tests, verify PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): dashboard with filters and status actions"
```

---

### Task 9: Sources, Notifications, Runs screens + "Run now"

**Files:**
- Create: `apps/web/src/routes/sources.tsx`
- Create: `apps/web/src/routes/notifications.tsx`
- Create: `apps/web/src/routes/runs.tsx`
- Create: `apps/web/src/lib/sources.ts`, `notifiers.ts`, `runs.ts`, `scan.ts`
- Test: one component test per route

**Interfaces:**
- `useSources()`, `useUpdateSources()` calling `GET /sources` and `PUT /sources/github`.
- `useNotifiers()`, `useUpdateNotifier(id)`, `useTestNotifier(id)` calling `POST /notifiers/:id/test`.
- `useRuns()` returns last 50; `useScanStatus()` polls `/scan/status` every 2s when `running`; `useTriggerScan()` POSTs `/scan` and starts polling.

- [ ] **Step 1: Sources screen with repos editor (text area, one per line) and rules toggles. Token field is write-only (placeholder "leave blank to keep current").**

- [ ] **Step 2: Notifications screen with form for SMTP fields. "Send test" button calls `POST /notifiers/:id/test`.**

- [ ] **Step 3: Runs screen as table; "Run now" button shows progress badge using `useScanStatus`.**

- [ ] **Step 4: Tests via `@testing-library`. Run, verify PASS, commit:**

```bash
git add apps/web
git commit -m "feat(web): sources, notifications, runs screens + run now"
```

---

### Task 10: CLI integration with DB-backed config + production bundling

**Files:**
- Modify: `apps/cli/src/config.ts` (add `loadConfigFromDb`)
- Modify: `apps/cli/src/commands/scan.ts` (already DI-friendly, no change)
- Modify: `apps/cli/src/bin.ts` (try DB first, fallback to YAML)
- Create: `apps/cli/src/commands/import-yaml.ts`
- Modify: `apps/api/src/server.ts` (register `@fastify/static` for `apps/web/dist` in production)
- Test: `apps/cli/src/config-from-db.test.ts`

**Interfaces:**
- `loadConfigFromDb(db, masterKey): Config` reads both source_config and notifier_config, returns the same `Config` shape Phase 1 already uses.
- `work-summary import-yaml --config <path>` reads YAML and writes DB rows.

- [ ] **Step 1: Implement loadConfigFromDb**

```ts
// apps/cli/src/config.ts (append)
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';
import type { Config } from './config.js';

export function loadConfigFromDb(db: SqliteDatabase, key: Buffer, githubLogin: string): Config {
  const src = createSourceConfigRepo(db, key).getGithub();
  if (!src) throw new ConfigError('No source config in DB');
  const notifs = createNotifierConfigRepo(db, key);
  const list = notifs.list();
  const notifications = list.map((n) => {
    const f = notifs.get(n.id);
    if (!f) throw new ConfigError(`notifier ${n.id} missing`);
    return {
      id: n.id, type: 'smtp' as const, enabled: n.enabled,
      smtp: { host: n.host, port: n.port, secure: n.secure, user: f.user, pass: f.pass },
      from: n.from, to: n.to, subjectTemplate: n.subjectTemplate,
    };
  });
  return {
    user: { githubLogin },
    sources: { github: { token: src.token, repos: src.repos, rules: src.rules, filters: src.filters } },
    scan: { lookbackDays: 7, concurrency: 3 },
    notifications,
    logging: { level: 'info', file: '~/.local/state/work-summary/scan.log' },
  };
}
```

- [ ] **Step 2: Implement `import-yaml` command**

Reads YAML via existing loader, writes to DB via the two config-db repos, renames file to `.imported`.

- [ ] **Step 3: Modify `bin.ts` scan handler**

Pseudo: try DB first (require `MASTER_PASSPHRASE`); on miss or no DB rows, fallback to YAML.

- [ ] **Step 4: Wire static serve in production**

In `server.ts`, register `@fastify/static` with `root: path.join(__dirname, '../../web/dist')`, `prefix: '/'`, only when `NODE_ENV === 'production'`.

- [ ] **Step 5: Tests for `loadConfigFromDb` round-trip with `runMigrations` + encrypted secrets**

Run all tests, verify PASS, commit:

```bash
git add apps/cli apps/api
git commit -m "feat: DB-backed config, CLI/API parity, import-yaml command, prod static serve"
```

---

### Task 11: Playwright E2E smoke + README updates

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/dashboard.spec.ts`
- Create: `e2e/package.json`
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Playwright config + test**

```ts
// e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';
test('login and mark addressed', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.getByLabel(/username/i).fill('me');
  await page.getByLabel(/password/i).fill('pw1234567');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});
```

- [ ] **Step 2: Boot script (`pnpm e2e:setup`) starts the API on :3001 with a seeded DB and a known user, web on :5173.**

- [ ] **Step 3: Add Phase 2 section to README.**

- [ ] **Step 4: Commit + push**

```bash
git add e2e README.md
git commit -m "test(e2e): Playwright smoke for login + dashboard"
git push origin main
```

---

## Self-Review Checklist

- Every endpoint in spec section 7 has a route handler in Task 5.
- All six tables in section 5 are created in migration 0002 (Task 1).
- Auth flow from section 9: bootstrap (Task 4), login + cookie (Task 4), guard (Task 4), CSRF via SameSite=Lax (note: header-based CSRF deferred; SameSite is sufficient for single-origin in Phase 2 - revisit).
- Encryption (section 10): `packages/auth` covers it; all secret columns use `encryptSecret`.
- CLI compatibility (section 11): Task 10 `loadConfigFromDb` + fallback in bin.ts.
- Manual scan (section 12): Task 5 includes `scan-runner` with single-flight lock.
- No em-dashes anywhere in this plan.
