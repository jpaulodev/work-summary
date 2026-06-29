# Phase 1 - Core Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `work-summary` CLI that scans configured GitHub repos for PR/issue comments awaiting the user's response and emails a deduplicated digest via SMTP, runnable from OS cron.

**Architecture:** pnpm monorepo with a pure `core` package (matching rules, types) and three adapters (`github-source`, `storage`, `notifiers`) consumed by a thin commander-based `apps/cli`. State persisted in SQLite via better-sqlite3; emails sent via nodemailer with eta HTML templates.

**Tech Stack:** TypeScript 5 (strict), Node 20+, pnpm workspaces, turbo, commander, zod, @octokit/rest + @octokit/plugin-throttling, better-sqlite3, nodemailer, eta, pino, p-limit, vitest, msw/node, smtp-tester, ESLint flat config + Prettier.

## Global Constraints

- All TypeScript packages compile with `"strict": true` and `"noUncheckedIndexedAccess": true`.
- Node engine: `>=20.0.0` declared in every `package.json`.
- No package depends on another adapter (only `core` is shared upward); `core` has zero IO dependencies.
- Config path: `~/.config/work-summary/config.yaml` (override with `--config`). State path: `~/.local/state/work-summary/state.db`. Both follow XDG Base Directory.
- Exit codes are fixed: 0 success, 1 unexpected, 2 invalid config, 3 GitHub auth, 4 SMTP, 5 storage IO, 10 dry-run-would-send.
- No em-dashes (-) anywhere; use hyphens (-) instead.
- Tokens, passwords, and comment bodies must never appear in logs except when `--debug` is explicitly enabled (and even then, never tokens).
- Every package exposes a `package.json` with `"type": "module"` and ESM output.
- Tests live next to source as `*.test.ts` and run via `vitest`. Test commands invoked by tasks must produce the expected pass/fail outcomes stated below.
- All commits use Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).

---

### Task 1: Monorepo Bootstrap

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.editorconfig`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore` (already exists, append turbo/build dirs)

**Interfaces:**
- Consumes: nothing.
- Produces: pnpm workspace where `pnpm -r build`, `pnpm -r test`, `pnpm -r lint` work; CI matrix on Node 20 + 22.

- [ ] **Step 1: Write root `package.json`**

Create `package.json`:

```json
{
  "name": "work-summary",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "eslint": "^9.10.0",
    "@eslint/js": "^9.10.0",
    "typescript-eslint": "^8.5.0",
    "prettier": "^3.3.3",
    "turbo": "^2.1.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write workspace config**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": { "outputs": [] },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 3: Write shared TS config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Write `.nvmrc` and `.editorconfig`**

Create `.nvmrc`:

```
20
```

Create `.editorconfig`:

```
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
charset = utf-8
trim_trailing_whitespace = true
```

- [ ] **Step 5: Write Prettier config**

Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

Create `.prettierignore`:

```
dist
node_modules
*.log
*.db
coverage
.turbo
```

- [ ] **Step 6: Write ESLint flat config**

Create `eslint.config.mjs`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 7: Update `.gitignore`**

Append to `.gitignore`:

```
dist/
.turbo/
coverage/
*.db
*.db-journal
.env
.env.local
```

- [ ] **Step 8: Write CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.0 }
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 9: Install root dev dependencies and verify**

Run:

```bash
pnpm install
pnpm format:check || pnpm format
```

Expected: `pnpm-lock.yaml` created, no errors.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: bootstrap pnpm monorepo with turbo, eslint, prettier, CI"
```

---

### Task 2: `core` package - types and `computePendingCommentId`

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/id.ts`
- Test: `packages/core/src/id.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PendingComment`, `MatchRule`, `MatchRulesConfig`, `BotFilterConfig`, `ScanContext` types.
  - `computePendingCommentId(parts: { source: string; repo: string; type: string; nativeId: string }): string` - deterministic SHA-256 hex of `${source}:${repo}:${type}:${nativeId}`, truncated to 16 chars.

- [ ] **Step 1: Create package skeleton**

Create `packages/core/package.json`:

```json
{
  "name": "@work-summary/core",
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
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Define types**

Create `packages/core/src/types.ts`:

```ts
export type MatchRule =
  | 'author_of_pr_unanswered'
  | 'mentioned'
  | 'replied_before_then_followup'
  | 'assignee'
  | 'changes_requested';

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

export interface PendingComment {
  id: string;
  source: 'github';
  repo: string;
  containerType: 'pr' | 'issue';
  containerNumber: number;
  containerTitle: string;
  containerUrl: string;
  commentId: string;
  commentUrl: string;
  author: { login: string; isBot: boolean };
  body: string;
  createdAt: string;
  matchedRules: MatchRule[];
}

export interface RawComment {
  nativeId: string;
  url: string;
  author: { login: string; isBot: boolean };
  body: string;
  createdAt: string;
}

export interface RawReview {
  state: 'CHANGES_REQUESTED' | 'APPROVED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  author: { login: string; isBot: boolean };
  submittedAt: string;
}

export interface RawContainer {
  type: 'pr' | 'issue';
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  assigneeLogins: string[];
  comments: RawComment[];
  reviews: RawReview[];
  lastUserCommitAt: string | null;
}

export interface ScanContext {
  source: 'github';
  repo: string;
  userLogin: string;
  containers: RawContainer[];
}
```

- [ ] **Step 3: Write failing test for `computePendingCommentId`**

Create `packages/core/src/id.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePendingCommentId } from './id.js';

describe('computePendingCommentId', () => {
  it('produces deterministic 16-char hex for same inputs', () => {
    const a = computePendingCommentId({ source: 'github', repo: 'org/r', type: 'pr_comment', nativeId: '123' });
    const b = computePendingCommentId({ source: 'github', repo: 'org/r', type: 'pr_comment', nativeId: '123' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it('differs when any field differs', () => {
    const base = { source: 'github', repo: 'org/r', type: 'pr_comment', nativeId: '123' };
    const ids = new Set([
      computePendingCommentId(base),
      computePendingCommentId({ ...base, source: 'jira' }),
      computePendingCommentId({ ...base, repo: 'org/r2' }),
      computePendingCommentId({ ...base, type: 'issue_comment' }),
      computePendingCommentId({ ...base, nativeId: '124' }),
    ]);
    expect(ids.size).toBe(5);
  });
});
```

- [ ] **Step 4: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test`

Expected: FAIL with `Cannot find module './id.js'`.

- [ ] **Step 5: Implement**

Create `packages/core/src/id.ts`:

```ts
import { createHash } from 'node:crypto';

export interface CommentIdParts {
  source: string;
  repo: string;
  type: string;
  nativeId: string;
}

export function computePendingCommentId(parts: CommentIdParts): string {
  const input = `${parts.source}:${parts.repo}:${parts.type}:${parts.nativeId}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
```

Create `packages/core/src/index.ts`:

```ts
export * from './types.js';
export * from './id.js';
```

- [ ] **Step 6: Run test, verify pass**

Run: `pnpm --filter @work-summary/core test`

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): add PendingComment types and computePendingCommentId"
```

---

### Task 3: `core` - matchComments rule A (author_of_pr_unanswered)

**Files:**
- Create: `packages/core/src/match.ts`
- Create: `packages/core/src/match-helpers.ts`
- Test: `packages/core/src/match-rule-a.test.ts`
- Modify: `packages/core/src/index.ts` (re-export `matchComments`)

**Interfaces:**
- Consumes: types from Task 2.
- Produces:
  - `matchComments(context: ScanContext, rules: MatchRulesConfig, filters: BotFilterConfig): PendingComment[]`
  - Helper `lastCommentByUserAt(container: RawContainer, login: string): string | null` (ISO timestamp or null).

- [ ] **Step 1: Write failing test for rule A**

Create `packages/core/src/match-rule-a.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});

const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

describe('matchComments - rule A (author_of_pr_unanswered)', () => {
  it('matches a comment from someone else on my PR when I have not replied since', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: 'feat: x',
          url: 'https://gh/pr/7',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: 'https://gh/c1',
              author: { login: 'alice', isBot: false },
              body: 'please update',
              createdAt: '2026-06-01T10:00:00Z',
            },
          ],
        },
      ],
    };
    const result = matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter);
    expect(result).toHaveLength(1);
    expect(result[0]?.commentId).toBe('c1');
    expect(result[0]?.matchedRules).toEqual(['author_of_pr_unanswered']);
  });

  it('does NOT match when I replied after the comment', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: '', createdAt: '2026-06-01T10:00:00Z' },
            { nativeId: 'c2', url: '', author: { login: 'me', isBot: false }, body: '', createdAt: '2026-06-01T11:00:00Z' },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match PRs not authored by me', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: '', createdAt: '2026-06-01T10:00:00Z' },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match issues (rule A is PR-only)', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: '', createdAt: '2026-06-01T10:00:00Z' },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test`

Expected: FAIL with `Cannot find module './match.js'`.

- [ ] **Step 3: Implement helpers and matcher**

Create `packages/core/src/match-helpers.ts`:

```ts
import type { RawContainer, PendingComment } from './types.js';
import { computePendingCommentId } from './id.js';

export function lastCommentByUserAt(container: RawContainer, login: string): string | null {
  let latest: string | null = null;
  for (const c of container.comments) {
    if (c.author.login === login) {
      if (!latest || c.createdAt > latest) latest = c.createdAt;
    }
  }
  return latest;
}

export function isAfter(a: string, b: string | null): boolean {
  return b === null ? true : a > b;
}

export function toPendingComment(
  source: 'github',
  repo: string,
  container: RawContainer,
  commentNativeId: string,
  commentUrl: string,
  author: { login: string; isBot: boolean },
  body: string,
  createdAt: string,
  matched: PendingComment['matchedRules'],
  type: 'pr_comment' | 'issue_comment' | 'review',
): PendingComment {
  return {
    id: computePendingCommentId({ source, repo, type, nativeId: commentNativeId }),
    source,
    repo,
    containerType: container.type,
    containerNumber: container.number,
    containerTitle: container.title,
    containerUrl: container.url,
    commentId: commentNativeId,
    commentUrl,
    author,
    body,
    createdAt,
    matchedRules: matched,
  };
}
```

Create `packages/core/src/match.ts`:

```ts
import type {
  ScanContext,
  MatchRulesConfig,
  BotFilterConfig,
  PendingComment,
  RawContainer,
  RawComment,
} from './types.js';
import { lastCommentByUserAt, isAfter, toPendingComment } from './match-helpers.js';

interface Candidate {
  comment: RawComment;
  container: RawContainer;
  rules: PendingComment['matchedRules'];
}

function addRule(map: Map<string, Candidate>, key: string, container: RawContainer, comment: RawComment, rule: PendingComment['matchedRules'][number]): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.rules.includes(rule)) existing.rules.push(rule);
  } else {
    map.set(key, { comment, container, rules: [rule] });
  }
}

export function matchComments(
  context: ScanContext,
  rules: MatchRulesConfig,
  _filters: BotFilterConfig,
): PendingComment[] {
  const candidates = new Map<string, Candidate>();
  const me = context.userLogin;

  for (const container of context.containers) {
    const myLastAt = lastCommentByUserAt(container, me);

    if (rules.authorOfPrUnanswered && container.type === 'pr' && container.authorLogin === me) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (isAfter(c.createdAt, myLastAt)) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'author_of_pr_unanswered');
        }
      }
    }
  }

  const out: PendingComment[] = [];
  for (const cand of candidates.values()) {
    out.push(
      toPendingComment(
        context.source,
        context.repo,
        cand.container,
        cand.comment.nativeId,
        cand.comment.url,
        cand.comment.author,
        cand.comment.body,
        cand.comment.createdAt,
        cand.rules,
        cand.container.type === 'pr' ? 'pr_comment' : 'issue_comment',
      ),
    );
  }
  return out;
}
```

Update `packages/core/src/index.ts`:

```ts
export * from './types.js';
export * from './id.js';
export * from './match.js';
export { lastCommentByUserAt } from './match-helpers.js';
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @work-summary/core test`

Expected: PASS, all rule A tests pass (along with id tests from Task 2).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): matchComments rule A (author_of_pr_unanswered)"
```

---

### Task 4: `core` - rule B (mentioned)

**Files:**
- Modify: `packages/core/src/match.ts`
- Test: `packages/core/src/match-rule-b.test.ts`

**Interfaces:**
- Consumes: types and `matchComments` from Tasks 2-3.
- Produces: rule B matching - any comment whose body contains `@${userLogin}` (word-boundary, case-insensitive) is matched. Self-mentions (author === userLogin) excluded.

- [ ] **Step 1: Write failing test**

Create `packages/core/src/match-rule-b.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

function ctx(body: string, authorLogin = 'alice'): ScanContext {
  return {
    source: 'github',
    repo: 'org/repo',
    userLogin: 'me',
    containers: [
      {
        type: 'issue',
        number: 1,
        title: '',
        url: '',
        authorLogin: 'other',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments: [{ nativeId: 'c1', url: '', author: { login: authorLogin, isBot: false }, body, createdAt: '2026-06-01T10:00:00Z' }],
      },
    ],
  };
}

describe('matchComments - rule B (mentioned)', () => {
  it('matches @me at start of body', () => {
    expect(matchComments(ctx('@me please look'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
  });

  it('matches @Me case-insensitively', () => {
    expect(matchComments(ctx('cc @Me'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
  });

  it('does NOT match @method or @members (word boundary)', () => {
    expect(matchComments(ctx('use @method here'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(0);
    expect(matchComments(ctx('hi @members'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match self-mention', () => {
    expect(matchComments(ctx('@me I said', 'me'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(0);
  });

  it('matches @me at end and in middle', () => {
    expect(matchComments(ctx('thanks @me!'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
    expect(matchComments(ctx('hi @me how are you'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test match-rule-b`

Expected: FAIL (no rule B logic yet, 0 matches where 1 expected).

- [ ] **Step 3: Implement rule B in matcher**

Edit `packages/core/src/match.ts`. After the rule A loop inside `for (const container of context.containers)`, add:

```ts
    if (rules.mentioned) {
      const re = new RegExp(`(^|[^\\w])@${escapeRegex(me)}(?!\\w)`, 'i');
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (re.test(c.body)) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'mentioned');
        }
      }
    }
```

Add at the top of `match.ts` (after imports):

```ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/core test match-rule-b`

Expected: PASS, all 5 rule B tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): matchComments rule B (mentioned)"
```

---

### Task 5: `core` - rule D (replied_before_then_followup)

**Files:**
- Modify: `packages/core/src/match.ts`
- Test: `packages/core/src/match-rule-d.test.ts`

**Interfaces:**
- Consumes: types from Tasks 2-3.
- Produces: rule D matching - if user has commented in the thread, any subsequent comment from someone else in the thread is matched.

- [ ] **Step 1: Write failing test**

Create `packages/core/src/match-rule-d.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig, RawComment } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

function mkComment(nativeId: string, login: string, createdAt: string): RawComment {
  return { nativeId, url: '', author: { login, isBot: false }, body: '', createdAt };
}

function ctx(comments: RawComment[]): ScanContext {
  return {
    source: 'github',
    repo: 'org/repo',
    userLogin: 'me',
    containers: [
      {
        type: 'pr',
        number: 1,
        title: '',
        url: '',
        authorLogin: 'other',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments,
      },
    ],
  };
}

describe('matchComments - rule D (replied_before_then_followup)', () => {
  it('matches comments after my last comment from others', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
        mkComment('c3', 'bob', '2026-06-01T12:00:00Z'),
        mkComment('c4', 'alice', '2026-06-01T13:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r.map((x) => x.commentId).sort()).toEqual(['c3', 'c4']);
  });

  it('does NOT match if I never commented', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'bob', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });

  it('does NOT match my own follow-up comments', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'me', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });

  it('does NOT match if my comment is latest', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test match-rule-d`

Expected: FAIL.

- [ ] **Step 3: Implement rule D**

In `packages/core/src/match.ts`, inside the container loop after rule B, add:

```ts
    if (rules.repliedBeforeThenFollowup && myLastAt !== null) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (c.createdAt > myLastAt) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'replied_before_then_followup');
        }
      }
    }
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/core test match-rule-d`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): matchComments rule D (replied_before_then_followup)"
```

---

### Task 6: `core` - rule E (assignee)

**Files:**
- Modify: `packages/core/src/match.ts`
- Test: `packages/core/src/match-rule-e.test.ts`

**Interfaces:**
- Consumes: types from Tasks 2-3.
- Produces: rule E - if I am in `container.assigneeLogins`, any comment from someone else without a later reply from me is matched.

- [ ] **Step 1: Write failing test**

Create `packages/core/src/match-rule-e.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

describe('matchComments - rule E (assignee)', () => {
  it('matches comments on issues where I am assigned and have not replied', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['me', 'jane'],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: 'help', createdAt: '2026-06-01T10:00:00Z' },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(1);
  });

  it('does NOT match when I am not assigned', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['jane'],
          reviews: [],
          lastUserCommitAt: null,
          comments: [{ nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: '', createdAt: '2026-06-01T10:00:00Z' }],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match when I already replied after the comment', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['me'],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'alice', isBot: false }, body: '', createdAt: '2026-06-01T10:00:00Z' },
            { nativeId: 'c2', url: '', author: { login: 'me', isBot: false }, body: '', createdAt: '2026-06-01T11:00:00Z' },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test match-rule-e`

Expected: FAIL.

- [ ] **Step 3: Implement rule E**

In `packages/core/src/match.ts`, inside the container loop, add:

```ts
    if (rules.assignee && container.assigneeLogins.includes(me)) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (isAfter(c.createdAt, myLastAt)) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'assignee');
        }
      }
    }
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/core test match-rule-e`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): matchComments rule E (assignee)"
```

---

### Task 7: `core` - rule F (changes_requested)

**Files:**
- Modify: `packages/core/src/match.ts`
- Modify: `packages/core/src/match-helpers.ts`
- Test: `packages/core/src/match-rule-f.test.ts`

**Interfaces:**
- Consumes: types from Tasks 2-3.
- Produces: rule F - on a PR I authored, any `CHANGES_REQUESTED` review such that I have not pushed a new commit OR replied with a comment after the review timestamp creates a synthetic pending entry whose `commentId` is `review:<reviewId>` and `type` is `review`.

- [ ] **Step 1: Write failing test**

Create `packages/core/src/match-rule-f.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

describe('matchComments - rule F (changes_requested)', () => {
  it('matches an unanswered CHANGES_REQUESTED review on my PR', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: 'feat',
          url: 'https://gh/pr/1',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            {
              state: 'CHANGES_REQUESTED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    const r = matchComments(ctx, rulesOnly('changesRequested'), noBotFilter);
    expect(r).toHaveLength(1);
    expect(r[0]?.matchedRules).toEqual(['changes_requested']);
  });

  it('does NOT match if I pushed a commit after the review', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            { state: 'CHANGES_REQUESTED', author: { login: 'alice', isBot: false }, submittedAt: '2026-06-01T10:00:00Z' },
          ],
          comments: [],
          lastUserCommitAt: '2026-06-01T11:00:00Z',
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match if I commented after the review', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            { state: 'CHANGES_REQUESTED', author: { login: 'alice', isBot: false }, submittedAt: '2026-06-01T10:00:00Z' },
          ],
          comments: [
            { nativeId: 'c1', url: '', author: { login: 'me', isBot: false }, body: 'fixed', createdAt: '2026-06-01T11:00:00Z' },
          ],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match APPROVED or COMMENTED reviews', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            { state: 'APPROVED', author: { login: 'alice', isBot: false }, submittedAt: '2026-06-01T10:00:00Z' },
            { state: 'COMMENTED', author: { login: 'bob', isBot: false }, submittedAt: '2026-06-01T10:00:00Z' },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match if PR not authored by me', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: [],
          reviews: [
            { state: 'CHANGES_REQUESTED', author: { login: 'alice', isBot: false }, submittedAt: '2026-06-01T10:00:00Z' },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test match-rule-f`

Expected: FAIL.

- [ ] **Step 3: Add review-id helper**

Append to `packages/core/src/match-helpers.ts`:

```ts
import type { RawReview } from './types.js';

export function reviewSyntheticId(containerNumber: number, review: RawReview): string {
  return `review:${containerNumber}:${review.author.login}:${review.submittedAt}`;
}
```

- [ ] **Step 4: Implement rule F**

In `packages/core/src/match.ts`, import `reviewSyntheticId` from `./match-helpers.js`. Inside the container loop, add:

```ts
    if (rules.changesRequested && container.type === 'pr' && container.authorLogin === me) {
      for (const review of container.reviews) {
        if (review.state !== 'CHANGES_REQUESTED') continue;
        const after = review.submittedAt;
        const pushedAfter = container.lastUserCommitAt !== null && container.lastUserCommitAt > after;
        const repliedAfter = container.comments.some(
          (c) => c.author.login === me && c.createdAt > after,
        );
        if (pushedAfter || repliedAfter) continue;
        const nativeId = reviewSyntheticId(container.number, review);
        const synthetic = {
          nativeId,
          url: container.url,
          author: review.author,
          body: `Changes requested by @${review.author.login}`,
          createdAt: review.submittedAt,
        };
        addRule(candidates, `${container.number}:${nativeId}`, container, synthetic, 'changes_requested');
      }
    }
```

Modify `toPendingComment` calls so review-type candidates serialize correctly. In the final `for (const cand of candidates.values())` block, replace the `type` argument with:

```ts
        cand.rules.includes('changes_requested')
          ? 'review'
          : cand.container.type === 'pr'
            ? 'pr_comment'
            : 'issue_comment',
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/core test`

Expected: PASS, all rule tests (A, B, D, E, F) pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): matchComments rule F (changes_requested)"
```

---

### Task 8: `core` - bot filter integration

**Files:**
- Modify: `packages/core/src/match.ts`
- Test: `packages/core/src/match-bot-filter.test.ts`

**Interfaces:**
- Consumes: `BotFilterConfig` from Task 2.
- Produces: when `filters.excludeBots === true`, any candidate whose `comment.author.isBot === true` and whose `comment.author.login` is NOT in `filters.botWhitelist` is dropped from the result.

- [ ] **Step 1: Write failing test**

Create `packages/core/src/match-bot-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const allRules: MatchRulesConfig = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

function ctxWithBot(isBot: boolean, login = 'dependabot[bot]'): ScanContext {
  return {
    source: 'github',
    repo: 'org/repo',
    userLogin: 'me',
    containers: [
      {
        type: 'pr',
        number: 1,
        title: '',
        url: '',
        authorLogin: 'me',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments: [{ nativeId: 'c1', url: '', author: { login, isBot }, body: 'bump', createdAt: '2026-06-01T10:00:00Z' }],
      },
    ],
  };
}

describe('matchComments - bot filter', () => {
  it('excludes bot comments when excludeBots=true', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: [] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(0);
  });

  it('includes whitelisted bot even when excludeBots=true', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: ['dependabot[bot]'] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(1);
  });

  it('includes bot comments when excludeBots=false', () => {
    const filters: BotFilterConfig = { excludeBots: false, botWhitelist: [] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(1);
  });

  it('never filters human comments', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: [] };
    expect(matchComments(ctxWithBot(false, 'alice'), allRules, filters)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/core test match-bot-filter`

Expected: FAIL (bot included when it should be excluded).

- [ ] **Step 3: Implement filter**

In `packages/core/src/match.ts`, replace the unused `_filters` parameter with `filters`. In the final emission loop, before pushing, add:

```ts
  for (const cand of candidates.values()) {
    if (filters.excludeBots && cand.comment.author.isBot && !filters.botWhitelist.includes(cand.comment.author.login)) {
      continue;
    }
    out.push(/* ... existing toPendingComment call ... */);
  }
```

- [ ] **Step 4: Run all core tests**

Run: `pnpm --filter @work-summary/core test`

Expected: PASS, every test (id, rules A-F, bot filter).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): bot filter (excludeBots + botWhitelist)"
```

---

### Task 9: `storage` - DB init and migration 0001

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/migrations/0001_init.sql`
- Create: `packages/storage/src/index.ts`
- Create: `packages/storage/src/db.ts`
- Create: `packages/storage/src/migrate.ts`
- Test: `packages/storage/src/migrate.test.ts`

**Interfaces:**
- Consumes: nothing (depends only on better-sqlite3).
- Produces:
  - `openDatabase(path: string): Database` - returns a `better-sqlite3` Database with WAL enabled and `foreign_keys = ON`. `path` may be `:memory:`.
  - `runMigrations(db: Database): { applied: number[] }` - applies any migration whose version > current `schema_version`. Idempotent.

- [ ] **Step 1: Create package skeleton**

Create `packages/storage/package.json`:

```json
{
  "name": "@work-summary/storage",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json && cp -r migrations dist/migrations",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@work-summary/core": "workspace:*",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `packages/storage/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write migration 0001**

Create `packages/storage/migrations/0001_init.sql`:

```sql
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
  matched_rules TEXT NOT NULL,
  notified_at TEXT NOT NULL
);
CREATE INDEX idx_notified_repo ON notified_comments(repo);
CREATE INDEX idx_notified_at ON notified_comments(notified_at);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  comments_found INTEGER DEFAULT 0,
  comments_notified INTEGER DEFAULT 0,
  error_message TEXT,
  source_stats TEXT
);
CREATE INDEX idx_runs_started ON runs(started_at);

CREATE TABLE source_watermarks (
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (source, repo)
);
```

- [ ] **Step 3: Write failing migration test**

Create `packages/storage/src/migrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  it('applies 0001 on a fresh in-memory DB', () => {
    const db = openDatabase(':memory:');
    const result = runMigrations(db);
    expect(result.applied).toEqual([1]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('notified_comments');
    expect(names).toContain('runs');
    expect(names).toContain('source_watermarks');
    expect(names).toContain('schema_version');
  });

  it('is idempotent on second run', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const second = runMigrations(db);
    expect(second.applied).toEqual([]);
  });

  it('records applied version in schema_version', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
    expect(rows.map((r) => r.version)).toEqual([1]);
  });
});
```

- [ ] **Step 4: Run test, verify failure**

Run: `pnpm --filter @work-summary/storage test`

Expected: FAIL with module-not-found.

- [ ] **Step 5: Implement db + migrate**

Create `packages/storage/src/db.ts`:

```ts
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

export type SqliteDatabase = DB;

export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

Create `packages/storage/src/migrate.ts`:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDatabase } from './db.js';

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'migrations'), join(here, '..', '..', 'migrations')];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Migrations directory not found near ${here}`);
}

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const dir = migrationsDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const match = /^(\d+)_(.+)\.sql$/.exec(f);
      if (!match) throw new Error(`Bad migration filename: ${f}`);
      return {
        version: parseInt(match[1]!, 10),
        name: match[2]!,
        sql: readFileSync(join(dir, f), 'utf8'),
      };
    });
}

function ensureVersionTable(db: SqliteDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
}

function appliedVersions(db: SqliteDatabase): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_version').all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

export function runMigrations(db: SqliteDatabase): { applied: number[] } {
  ensureVersionTable(db);
  const already = appliedVersions(db);
  const all = loadMigrations();
  const applied: number[] = [];
  for (const m of all) {
    if (already.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString(),
      );
    });
    tx();
    applied.push(m.version);
  }
  return { applied };
}
```

Create `packages/storage/src/index.ts`:

```ts
export { openDatabase } from './db.js';
export type { SqliteDatabase } from './db.js';
export { runMigrations } from './migrate.js';
```

- [ ] **Step 6: Run test, verify pass**

Run: `pnpm --filter @work-summary/storage test`

Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): DB init with WAL and migration 0001"
```

---

### Task 10: `storage` - commentsRepo

**Files:**
- Create: `packages/storage/src/comments-repo.ts`
- Test: `packages/storage/src/comments-repo.test.ts`
- Modify: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDatabase` from Task 9, `PendingComment` from `@work-summary/core`.
- Produces:
  - `createCommentsRepo(db: SqliteDatabase): CommentsRepo`
  - `CommentsRepo.filterUnnotified(comments: PendingComment[]): PendingComment[]`
  - `CommentsRepo.markAsNotified(comments: PendingComment[], notifiedAt: string): void`

- [ ] **Step 1: Write failing test**

Create `packages/storage/src/comments-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createCommentsRepo } from './comments-repo.js';
import type { PendingComment } from '@work-summary/core';
import type { SqliteDatabase } from './db.js';

function mkComment(id: string): PendingComment {
  return {
    id,
    source: 'github',
    repo: 'org/r',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: '',
    containerUrl: '',
    commentId: id,
    commentUrl: '',
    author: { login: 'alice', isBot: false },
    body: 'hi',
    createdAt: '2026-06-01T00:00:00Z',
    matchedRules: ['mentioned'],
  };
}

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('commentsRepo', () => {
  it('filterUnnotified returns all when DB empty', () => {
    const repo = createCommentsRepo(db);
    const input = [mkComment('a'), mkComment('b')];
    expect(repo.filterUnnotified(input).map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('markAsNotified persists ids, filterUnnotified skips them', () => {
    const repo = createCommentsRepo(db);
    repo.markAsNotified([mkComment('a')], '2026-06-01T00:00:00Z');
    const input = [mkComment('a'), mkComment('b')];
    expect(repo.filterUnnotified(input).map((c) => c.id)).toEqual(['b']);
  });

  it('markAsNotified is idempotent (re-marking same id does not throw)', () => {
    const repo = createCommentsRepo(db);
    repo.markAsNotified([mkComment('a')], '2026-06-01T00:00:00Z');
    repo.markAsNotified([mkComment('a')], '2026-06-02T00:00:00Z');
    const input = [mkComment('a')];
    expect(repo.filterUnnotified(input)).toEqual([]);
  });

  it('handles empty input arrays', () => {
    const repo = createCommentsRepo(db);
    expect(repo.filterUnnotified([])).toEqual([]);
    expect(() => repo.markAsNotified([], '2026-06-01T00:00:00Z')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/storage test comments-repo`

Expected: FAIL (module not found).

- [ ] **Step 3: Implement repo**

Create `packages/storage/src/comments-repo.ts`:

```ts
import type { PendingComment } from '@work-summary/core';
import type { SqliteDatabase } from './db.js';

export interface CommentsRepo {
  filterUnnotified(comments: PendingComment[]): PendingComment[];
  markAsNotified(comments: PendingComment[], notifiedAt: string): void;
}

export function createCommentsRepo(db: SqliteDatabase): CommentsRepo {
  const hasStmt = db.prepare('SELECT 1 FROM notified_comments WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO notified_comments
     (id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return {
    filterUnnotified(comments) {
      if (comments.length === 0) return [];
      return comments.filter((c) => hasStmt.get(c.id) === undefined);
    },
    markAsNotified(comments, notifiedAt) {
      if (comments.length === 0) return;
      const tx = db.transaction((items: PendingComment[]) => {
        for (const c of items) {
          insertStmt.run(
            c.id,
            c.source,
            c.repo,
            c.containerType,
            c.containerNumber,
            c.commentId,
            c.author.login,
            JSON.stringify(c.matchedRules),
            notifiedAt,
          );
        }
      });
      tx(comments);
    },
  };
}
```

Update `packages/storage/src/index.ts`:

```ts
export { openDatabase } from './db.js';
export type { SqliteDatabase } from './db.js';
export { runMigrations } from './migrate.js';
export { createCommentsRepo } from './comments-repo.js';
export type { CommentsRepo } from './comments-repo.js';
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/storage test`

Expected: PASS, all tests including comments-repo.

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): commentsRepo (filterUnnotified, markAsNotified)"
```

---

### Task 11: `storage` - runsRepo

**Files:**
- Create: `packages/storage/src/runs-repo.ts`
- Test: `packages/storage/src/runs-repo.test.ts`
- Modify: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDatabase` from Task 9.
- Produces:
  - `createRunsRepo(db, now: () => Date): RunsRepo`
  - `RunsRepo.startRun(): number` - inserts a row, returns `runs.id`.
  - `RunsRepo.finishRun(id, status: 'success' | 'partial' | 'failed', stats: RunStats): void`
  - `interface RunStats { commentsFound: number; commentsNotified: number; errorMessage?: string; sourceStats?: Record<string, { fetched: number; matched: number }>; }`

- [ ] **Step 1: Write failing test**

Create `packages/storage/src/runs-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createRunsRepo } from './runs-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('runsRepo', () => {
  it('startRun returns incrementing ids', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    expect(repo.startRun()).toBe(1);
    expect(repo.startRun()).toBe(2);
  });

  it('finishRun updates status and stats', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    const id = repo.startRun();
    repo.finishRun(id, 'success', {
      commentsFound: 7,
      commentsNotified: 3,
      sourceStats: { 'org/r': { fetched: 12, matched: 7 } },
    });
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.status).toBe('success');
    expect(row.comments_found).toBe(7);
    expect(row.comments_notified).toBe(3);
    expect(JSON.parse(String(row.source_stats))).toEqual({ 'org/r': { fetched: 12, matched: 7 } });
    expect(row.finished_at).not.toBeNull();
  });

  it('finishRun records error message on failed', () => {
    const repo = createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z'));
    const id = repo.startRun();
    repo.finishRun(id, 'failed', { commentsFound: 0, commentsNotified: 0, errorMessage: 'boom' });
    const row = db.prepare('SELECT error_message FROM runs WHERE id = ?').get(id) as { error_message: string };
    expect(row.error_message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/storage test runs-repo`

Expected: FAIL.

- [ ] **Step 3: Implement repo**

Create `packages/storage/src/runs-repo.ts`:

```ts
import type { SqliteDatabase } from './db.js';

export interface RunStats {
  commentsFound: number;
  commentsNotified: number;
  errorMessage?: string;
  sourceStats?: Record<string, { fetched: number; matched: number }>;
}

export interface RunsRepo {
  startRun(): number;
  finishRun(id: number, status: 'success' | 'partial' | 'failed', stats: RunStats): void;
}

export function createRunsRepo(db: SqliteDatabase, now: () => Date): RunsRepo {
  const insert = db.prepare(`INSERT INTO runs (started_at, status) VALUES (?, 'running')`);
  const update = db.prepare(
    `UPDATE runs
     SET finished_at = ?, status = ?, comments_found = ?, comments_notified = ?, error_message = ?, source_stats = ?
     WHERE id = ?`,
  );
  return {
    startRun() {
      const info = insert.run(now().toISOString());
      return Number(info.lastInsertRowid);
    },
    finishRun(id, status, stats) {
      update.run(
        now().toISOString(),
        status,
        stats.commentsFound,
        stats.commentsNotified,
        stats.errorMessage ?? null,
        stats.sourceStats ? JSON.stringify(stats.sourceStats) : null,
        id,
      );
    },
  };
}
```

Update `packages/storage/src/index.ts` to add:

```ts
export { createRunsRepo } from './runs-repo.js';
export type { RunsRepo, RunStats } from './runs-repo.js';
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/storage test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): runsRepo (startRun, finishRun)"
```

---

### Task 12: `storage` - watermarksRepo

**Files:**
- Create: `packages/storage/src/watermarks-repo.ts`
- Test: `packages/storage/src/watermarks-repo.test.ts`
- Modify: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `SqliteDatabase`.
- Produces:
  - `createWatermarksRepo(db): WatermarksRepo`
  - `WatermarksRepo.get(source: string, repo: string): string | null` - last success ISO or null.
  - `WatermarksRepo.set(source: string, repo: string, isoTimestamp: string): void` - upsert.

- [ ] **Step 1: Write failing test**

Create `packages/storage/src/watermarks-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase, runMigrations } from './index.js';
import { createWatermarksRepo } from './watermarks-repo.js';
import type { SqliteDatabase } from './db.js';

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db);
});

describe('watermarksRepo', () => {
  it('get returns null when no watermark exists', () => {
    const r = createWatermarksRepo(db);
    expect(r.get('github', 'org/repo')).toBeNull();
  });

  it('set then get returns the stored timestamp', () => {
    const r = createWatermarksRepo(db);
    r.set('github', 'org/repo', '2026-06-01T00:00:00Z');
    expect(r.get('github', 'org/repo')).toBe('2026-06-01T00:00:00Z');
  });

  it('set upserts (second set overwrites)', () => {
    const r = createWatermarksRepo(db);
    r.set('github', 'org/repo', '2026-06-01T00:00:00Z');
    r.set('github', 'org/repo', '2026-06-02T00:00:00Z');
    expect(r.get('github', 'org/repo')).toBe('2026-06-02T00:00:00Z');
  });

  it('keeps watermarks per (source, repo) independent', () => {
    const r = createWatermarksRepo(db);
    r.set('github', 'org/a', '2026-06-01T00:00:00Z');
    r.set('github', 'org/b', '2026-06-02T00:00:00Z');
    expect(r.get('github', 'org/a')).toBe('2026-06-01T00:00:00Z');
    expect(r.get('github', 'org/b')).toBe('2026-06-02T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/storage test watermarks-repo`

Expected: FAIL.

- [ ] **Step 3: Implement repo**

Create `packages/storage/src/watermarks-repo.ts`:

```ts
import type { SqliteDatabase } from './db.js';

export interface WatermarksRepo {
  get(source: string, repo: string): string | null;
  set(source: string, repo: string, isoTimestamp: string): void;
}

export function createWatermarksRepo(db: SqliteDatabase): WatermarksRepo {
  const getStmt = db.prepare(
    'SELECT last_success_at FROM source_watermarks WHERE source = ? AND repo = ?',
  );
  const setStmt = db.prepare(
    `INSERT INTO source_watermarks (source, repo, last_success_at)
     VALUES (?, ?, ?)
     ON CONFLICT(source, repo) DO UPDATE SET last_success_at = excluded.last_success_at`,
  );
  return {
    get(source, repo) {
      const row = getStmt.get(source, repo) as { last_success_at: string } | undefined;
      return row ? row.last_success_at : null;
    },
    set(source, repo, isoTimestamp) {
      setStmt.run(source, repo, isoTimestamp);
    },
  };
}
```

Update `packages/storage/src/index.ts`:

```ts
export { createWatermarksRepo } from './watermarks-repo.js';
export type { WatermarksRepo } from './watermarks-repo.js';
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/storage test`

Expected: PASS, all storage tests (migrate, comments-repo, runs-repo, watermarks-repo).

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): watermarksRepo (get/set per source+repo)"
```

---

### Task 13: `notifiers` - Notifier interface + SmtpNotifier skeleton

**Files:**
- Create: `packages/notifiers/package.json`
- Create: `packages/notifiers/tsconfig.json`
- Create: `packages/notifiers/src/index.ts`
- Create: `packages/notifiers/src/types.ts`
- Create: `packages/notifiers/src/smtp.ts`
- Test: `packages/notifiers/src/smtp.test.ts` (skeleton-only test for now)

**Interfaces:**
- Consumes: `PendingComment` from `@work-summary/core`.
- Produces:
  - `interface Notifier { readonly id: string; send(payload: NotificationPayload): Promise<void>; }`
  - `interface NotificationPayload { subject: string; comments: PendingComment[]; generatedAt: string; }`
  - `interface SmtpOptions { host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string; }`
  - `class SmtpNotifier implements Notifier` - skeleton, throws `Error('not implemented')` from `send` (real impl in Task 15).

- [ ] **Step 1: Create package skeleton**

Create `packages/notifiers/package.json`:

```json
{
  "name": "@work-summary/notifiers",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json && cp -r src/templates dist/templates",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@work-summary/core": "workspace:*",
    "eta": "^3.5.0",
    "nodemailer": "^6.9.15"
  },
  "devDependencies": {
    "@types/nodemailer": "^6.4.16",
    "smtp-tester": "^2.1.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `packages/notifiers/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Define types**

Create `packages/notifiers/src/types.ts`:

```ts
import type { PendingComment } from '@work-summary/core';

export interface NotificationPayload {
  subject: string;
  comments: PendingComment[];
  generatedAt: string;
}

export interface Notifier {
  readonly id: string;
  send(payload: NotificationPayload): Promise<void>;
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}
```

- [ ] **Step 3: Write failing test for skeleton**

Create `packages/notifiers/src/smtp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SmtpNotifier } from './smtp.js';

describe('SmtpNotifier (skeleton)', () => {
  it('exposes id "smtp"', () => {
    const n = new SmtpNotifier({
      host: 'localhost', port: 25, secure: false, user: 'u', pass: 'p',
      from: 'a@b', to: 'c@d',
    });
    expect(n.id).toBe('smtp');
  });
});
```

- [ ] **Step 4: Run test, verify failure**

Run: `pnpm --filter @work-summary/notifiers test`

Expected: FAIL (module not found).

- [ ] **Step 5: Implement skeleton**

Create `packages/notifiers/src/smtp.ts`:

```ts
import type { Notifier, NotificationPayload, SmtpOptions } from './types.js';

export class SmtpNotifier implements Notifier {
  readonly id = 'smtp';
  constructor(private readonly opts: SmtpOptions) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async send(_payload: NotificationPayload): Promise<void> {
    throw new Error('SmtpNotifier.send not implemented yet');
  }
}
```

Create `packages/notifiers/src/index.ts`:

```ts
export type { Notifier, NotificationPayload, SmtpOptions } from './types.js';
export { SmtpNotifier } from './smtp.js';
```

- [ ] **Step 6: Run test, verify pass**

Run: `pnpm --filter @work-summary/notifiers test`

Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add packages/notifiers
git commit -m "feat(notifiers): Notifier interface and SmtpNotifier skeleton"
```

---

### Task 14: `notifiers` - HTML template rendering (eta)

**Files:**
- Create: `packages/notifiers/src/templates/digest.eta`
- Create: `packages/notifiers/src/render.ts`
- Test: `packages/notifiers/src/render.test.ts`
- Modify: `packages/notifiers/src/index.ts`

**Interfaces:**
- Consumes: `PendingComment[]` and `NotificationPayload`.
- Produces:
  - `renderDigest(payload: NotificationPayload): { html: string; text: string }` - HTML grouped by repo, then PR/issue, then chronological comments. Plain-text fallback included.

- [ ] **Step 1: Write failing test**

Create `packages/notifiers/src/render.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderDigest } from './render.js';
import type { PendingComment } from '@work-summary/core';

function mk(overrides: Partial<PendingComment>): PendingComment {
  return {
    id: 'id1',
    source: 'github',
    repo: 'org/a',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: 'feat: x',
    containerUrl: 'https://gh/pr/1',
    commentId: 'c1',
    commentUrl: 'https://gh/c1',
    author: { login: 'alice', isBot: false },
    body: 'please review',
    createdAt: '2026-06-01T10:00:00Z',
    matchedRules: ['mentioned'],
    ...overrides,
  };
}

describe('renderDigest', () => {
  it('renders empty state when no comments', () => {
    const { html, text } = renderDigest({ subject: 'test', comments: [], generatedAt: '2026-06-01T12:00:00Z' });
    expect(html).toContain('No new comments');
    expect(text).toContain('No new comments');
  });

  it('groups comments by repo then by container', () => {
    const comments = [
      mk({ id: '1', repo: 'org/a', containerNumber: 1, commentId: 'c1' }),
      mk({ id: '2', repo: 'org/a', containerNumber: 2, commentId: 'c2', containerTitle: 'fix: y' }),
      mk({ id: '3', repo: 'org/b', containerNumber: 7, commentId: 'c3', containerTitle: 'docs' }),
    ];
    const { html } = renderDigest({ subject: 's', comments, generatedAt: '2026-06-01T12:00:00Z' });
    expect(html).toContain('org/a');
    expect(html).toContain('org/b');
    expect(html).toContain('feat: x');
    expect(html).toContain('fix: y');
    expect(html).toContain('docs');
    expect(html.indexOf('org/a')).toBeLessThan(html.indexOf('org/b'));
  });

  it('truncates body to 280 chars and escapes HTML', () => {
    const long = 'x'.repeat(400) + '<script>alert(1)</script>';
    const { html } = renderDigest({
      subject: 's',
      comments: [mk({ body: long })],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/x{280}/);
    expect(html).not.toMatch(/x{281}/);
    expect(html).toContain('...');
  });

  it('shows matched rules as labels', () => {
    const { html } = renderDigest({
      subject: 's',
      comments: [mk({ matchedRules: ['mentioned', 'assignee'] })],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toContain('mentioned');
    expect(html).toContain('assignee');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/notifiers test render`

Expected: FAIL (module not found).

- [ ] **Step 3: Write template**

Create `packages/notifiers/src/templates/digest.eta`:

```eta
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title><%= it.subject %></title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#24292f;max-width:720px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;border-bottom:1px solid #d0d7de;padding-bottom:8px"><%= it.subject %></h1>
  <p style="color:#57606a;font-size:13px">Generated at <%= it.generatedAt %></p>
  <% if (it.groups.length === 0) { %>
    <p>No new comments since last run.</p>
  <% } else { %>
    <% it.groups.forEach(function(group) { %>
      <h2 style="font-size:16px;margin-top:24px;color:#0969da"><%= group.repo %></h2>
      <% group.containers.forEach(function(container) { %>
        <h3 style="font-size:14px;margin-top:12px"><a href="<%= container.url %>" style="color:#0969da;text-decoration:none">#<%= container.number %> <%= container.title %></a></h3>
        <% container.comments.forEach(function(c) { %>
          <div style="border:1px solid #d0d7de;border-radius:6px;padding:12px;margin:8px 0;background:#f6f8fa">
            <div style="font-size:12px;color:#57606a;margin-bottom:6px">
              <strong>@<%= c.author %></strong> - <%= c.createdAt %>
              <% c.matchedRules.forEach(function(r) { %>
                <span style="display:inline-block;background:#dafbe1;color:#1a7f37;padding:2px 6px;border-radius:10px;font-size:11px;margin-left:4px"><%= r %></span>
              <% }) %>
            </div>
            <div style="font-size:13px;white-space:pre-wrap"><%= c.bodyPreview %></div>
            <a href="<%= c.url %>" style="font-size:12px;color:#0969da">View on GitHub -&gt;</a>
          </div>
        <% }) %>
      <% }) %>
    <% }) %>
  <% } %>
</body>
</html>
```

- [ ] **Step 4: Implement renderer**

Create `packages/notifiers/src/render.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Eta } from 'eta';
import type { NotificationPayload } from './types.js';
import type { PendingComment } from '@work-summary/core';

const BODY_LIMIT = 280;

function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'templates', 'digest.eta'), join(here, '..', 'src', 'templates', 'digest.eta')];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('digest.eta not found');
}

interface ContainerGroup {
  number: number;
  title: string;
  url: string;
  comments: Array<{
    author: string;
    createdAt: string;
    bodyPreview: string;
    url: string;
    matchedRules: string[];
  }>;
}

interface RepoGroup {
  repo: string;
  containers: ContainerGroup[];
}

function truncate(s: string): string {
  if (s.length <= BODY_LIMIT) return s;
  return s.slice(0, BODY_LIMIT) + '...';
}

function group(comments: PendingComment[]): RepoGroup[] {
  const byRepo = new Map<string, Map<number, ContainerGroup>>();
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of sorted) {
    let repo = byRepo.get(c.repo);
    if (!repo) {
      repo = new Map();
      byRepo.set(c.repo, repo);
    }
    let container = repo.get(c.containerNumber);
    if (!container) {
      container = { number: c.containerNumber, title: c.containerTitle, url: c.containerUrl, comments: [] };
      repo.set(c.containerNumber, container);
    }
    container.comments.push({
      author: c.author.login,
      createdAt: c.createdAt,
      bodyPreview: truncate(c.body),
      url: c.commentUrl,
      matchedRules: c.matchedRules,
    });
  }
  return [...byRepo.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([repo, containers]) => ({
      repo,
      containers: [...containers.values()].sort((a, b) => a.number - b.number),
    }));
}

function renderText(payload: NotificationPayload, groups: RepoGroup[]): string {
  if (groups.length === 0) return `${payload.subject}\n\nNo new comments since last run.\n`;
  const lines: string[] = [payload.subject, `Generated at ${payload.generatedAt}`, ''];
  for (const g of groups) {
    lines.push(`== ${g.repo} ==`);
    for (const c of g.containers) {
      lines.push(`  #${c.number} ${c.title}  (${c.url})`);
      for (const cm of c.comments) {
        lines.push(`    @${cm.author} [${cm.matchedRules.join(',')}] ${cm.createdAt}`);
        lines.push(`      ${cm.bodyPreview}`);
        lines.push(`      ${cm.url}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const eta = new Eta({ autoEscape: true });

export function renderDigest(payload: NotificationPayload): { html: string; text: string } {
  const groups = group(payload.comments);
  const tpl = readFileSync(templatePath(), 'utf8');
  const html = eta.renderString(tpl, { subject: payload.subject, generatedAt: payload.generatedAt, groups });
  const text = renderText(payload, groups);
  return { html, text };
}
```

Append to `packages/notifiers/src/index.ts`:

```ts
export { renderDigest } from './render.js';
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/notifiers test render`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/notifiers
git commit -m "feat(notifiers): HTML digest template + renderDigest (eta)"
```

---

### Task 15: `notifiers` - SmtpNotifier real implementation

**Files:**
- Modify: `packages/notifiers/src/smtp.ts`
- Test: `packages/notifiers/src/smtp-integration.test.ts`

**Interfaces:**
- Consumes: `SmtpOptions`, `NotificationPayload`, `renderDigest`.
- Produces:
  - `SmtpNotifier.send(payload)` opens a `nodemailer` transport, sends an email with `subject = payload.subject`, `from = opts.from`, `to = opts.to`, both `html` and `text` bodies from `renderDigest`.
  - On failure, throws an `Error` whose `name === 'SmtpError'` (used by CLI to map to exit code 4).

- [ ] **Step 1: Write failing integration test**

Create `packages/notifiers/src/smtp-integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import smtpTester from 'smtp-tester';
import { SmtpNotifier } from './smtp.js';
import type { PendingComment } from '@work-summary/core';

const PORT = 4025;
let mailServer: ReturnType<typeof smtpTester.init>;

beforeAll(() => {
  mailServer = smtpTester.init(PORT);
});

afterAll(() => {
  mailServer.stop(() => undefined);
});

function sampleComment(): PendingComment {
  return {
    id: 'x', source: 'github', repo: 'org/a', containerType: 'pr', containerNumber: 1,
    containerTitle: 'feat', containerUrl: 'https://gh/pr/1',
    commentId: 'c1', commentUrl: 'https://gh/c1',
    author: { login: 'alice', isBot: false }, body: 'please review',
    createdAt: '2026-06-01T10:00:00Z', matchedRules: ['mentioned'],
  };
}

describe('SmtpNotifier (integration via smtp-tester)', () => {
  it('sends an email with subject, html and text bodies', async () => {
    const n = new SmtpNotifier({
      host: '127.0.0.1', port: PORT, secure: false, user: '', pass: '',
      from: 'sender@test', to: 'me@test',
    });

    const received = new Promise<{ subject: string; html: string; text: string }>((resolve) => {
      mailServer.bind((_addr: string, _id: number, email: { headers: { subject: string }; html: string; body: string }) => {
        resolve({ subject: email.headers.subject, html: email.html, text: email.body });
      });
    });

    await n.send({ subject: '[work-summary] 1 new', comments: [sampleComment()], generatedAt: '2026-06-01T12:00:00Z' });

    const email = await received;
    expect(email.subject).toBe('[work-summary] 1 new');
    expect(email.html).toContain('org/a');
    expect(email.html).toContain('please review');
    expect(email.text).toContain('org/a');
  }, 15000);

  it('throws SmtpError when host unreachable', async () => {
    const n = new SmtpNotifier({
      host: '127.0.0.1', port: 1, secure: false, user: '', pass: '',
      from: 'a@b', to: 'c@d',
    });
    await expect(
      n.send({ subject: 's', comments: [], generatedAt: '2026-06-01T12:00:00Z' }),
    ).rejects.toMatchObject({ name: 'SmtpError' });
  }, 15000);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/notifiers test smtp-integration`

Expected: FAIL (current send throws 'not implemented').

- [ ] **Step 3: Implement send()**

Replace `packages/notifiers/src/smtp.ts` with:

```ts
import nodemailer, { type Transporter } from 'nodemailer';
import { renderDigest } from './render.js';
import type { Notifier, NotificationPayload, SmtpOptions } from './types.js';

export class SmtpError extends Error {
  override readonly name = 'SmtpError';
}

export class SmtpNotifier implements Notifier {
  readonly id = 'smtp';
  private transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user || opts.pass ? { user: opts.user, pass: opts.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  async send(payload: NotificationPayload): Promise<void> {
    const { html, text } = renderDigest(payload);
    try {
      await this.transporter.sendMail({
        from: this.opts.from,
        to: this.opts.to,
        subject: payload.subject,
        html,
        text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SmtpError(`SMTP send failed: ${msg}`);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SmtpError(`SMTP verify failed: ${msg}`);
    }
  }
}
```

Append export to `packages/notifiers/src/index.ts`:

```ts
export { SmtpError } from './smtp.js';
```

- [ ] **Step 4: Run all notifier tests**

Run: `pnpm --filter @work-summary/notifiers test`

Expected: PASS, all tests (skeleton, render, integration).

- [ ] **Step 5: Commit**

```bash
git add packages/notifiers
git commit -m "feat(notifiers): SmtpNotifier send/verify via nodemailer + SmtpError"
```

---

### Task 16: `github-source` - Octokit client with throttling

**Files:**
- Create: `packages/github-source/package.json`
- Create: `packages/github-source/tsconfig.json`
- Create: `packages/github-source/src/index.ts`
- Create: `packages/github-source/src/client.ts`
- Test: `packages/github-source/src/client.test.ts`

**Interfaces:**
- Consumes: nothing (depends on `@octokit/rest` and `@octokit/plugin-throttling`).
- Produces:
  - `createOctokit(opts: { token: string; userAgent?: string }): Octokit` - returns an Octokit with the throttling plugin enabled (max 3 retries on primary/secondary rate limits, exponential backoff handled by plugin), 30s request timeout.

- [ ] **Step 1: Create package skeleton**

Create `packages/github-source/package.json`:

```json
{
  "name": "@work-summary/github-source",
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
  "dependencies": {
    "@work-summary/core": "workspace:*",
    "@octokit/rest": "^21.0.2",
    "@octokit/plugin-throttling": "^9.3.2",
    "p-limit": "^6.1.0"
  },
  "devDependencies": {
    "msw": "^2.4.9",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `packages/github-source/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write failing test**

Create `packages/github-source/src/client.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createOctokit } from './client.js';

describe('createOctokit', () => {
  it('returns an object with .request and .rest', () => {
    const o = createOctokit({ token: 'fake' });
    expect(typeof o.request).toBe('function');
    expect(typeof o.rest.repos.get).toBe('function');
  });

  it('sets the user agent', () => {
    const o = createOctokit({ token: 'fake', userAgent: 'work-summary-test/0.1' });
    expect((o as unknown as { request: { endpoint: { DEFAULTS: { headers: Record<string, string> } } } }).request.endpoint.DEFAULTS.headers['user-agent']).toContain('work-summary-test/0.1');
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/github-source test`

Expected: FAIL.

- [ ] **Step 4: Implement client**

Create `packages/github-source/src/client.ts`:

```ts
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);

export interface OctokitOptions {
  token: string;
  userAgent?: string;
}

export type GithubClient = InstanceType<typeof ThrottledOctokit>;

export function createOctokit(opts: OctokitOptions): GithubClient {
  return new ThrottledOctokit({
    auth: opts.token,
    userAgent: opts.userAgent ?? 'work-summary/0.1.0',
    request: { timeout: 30000 },
    throttle: {
      onRateLimit: (retryAfter, options, _octokit, retryCount) => {
        if (retryCount < 3) return true;
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
        if (retryCount < 3) return true;
        return false;
      },
    },
  });
}
```

Create `packages/github-source/src/index.ts`:

```ts
export { createOctokit } from './client.js';
export type { GithubClient, OctokitOptions } from './client.js';
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/github-source test`

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): createOctokit with throttling plugin"
```

---

### Task 17: `github-source` - fetch open PRs + reviews

**Files:**
- Create: `packages/github-source/src/fetch-prs.ts`
- Create: `packages/github-source/test/fixtures/prs.ts`
- Create: `packages/github-source/test/msw-server.ts`
- Test: `packages/github-source/src/fetch-prs.test.ts`
- Modify: `packages/github-source/src/index.ts`

**Interfaces:**
- Consumes: `GithubClient` from Task 16.
- Produces:
  - `fetchOpenPullRequests(client, repo): Promise<RawPullRequest[]>`
  - `fetchPullRequestReviews(client, repo, number): Promise<RawReview[]>`
  - `interface RawPullRequest { number; title; htmlUrl; authorLogin; assigneeLogins[]; lastCommitAt: string | null; }`

- [ ] **Step 1: Write fixture and msw server**

Create `packages/github-source/test/fixtures/prs.ts`:

```ts
export const prListFixture = [
  {
    number: 7,
    title: 'feat: add x',
    html_url: 'https://github.com/org/r/pull/7',
    user: { login: 'me', type: 'User' },
    assignees: [{ login: 'jane' }],
    head: { sha: 'abc' },
  },
];

export const prHeadCommitFixture = {
  sha: 'abc',
  commit: { author: { date: '2026-06-01T09:00:00Z' } },
};

export const reviewsFixture = [
  { id: 1, state: 'CHANGES_REQUESTED', user: { login: 'alice', type: 'User' }, submitted_at: '2026-06-01T10:00:00Z' },
  { id: 2, state: 'COMMENTED', user: { login: 'bob', type: 'User' }, submitted_at: '2026-06-01T11:00:00Z' },
];
```

Create `packages/github-source/test/msw-server.ts`:

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { prListFixture, prHeadCommitFixture, reviewsFixture } from './fixtures/prs.js';

export function buildServer() {
  return setupServer(
    http.get('https://api.github.com/repos/:owner/:repo/pulls', () => HttpResponse.json(prListFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/commits/:sha', () => HttpResponse.json(prHeadCommitFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/pulls/:number/reviews', () => HttpResponse.json(reviewsFixture)),
  );
}
```

- [ ] **Step 2: Write failing test**

Create `packages/github-source/src/fetch-prs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchOpenPullRequests, fetchPullRequestReviews } from './fetch-prs.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchOpenPullRequests', () => {
  it('returns normalized PR list with head commit timestamp', async () => {
    const client = createOctokit({ token: 'fake' });
    const prs = await fetchOpenPullRequests(client, 'org/r');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 7,
      title: 'feat: add x',
      htmlUrl: 'https://github.com/org/r/pull/7',
      authorLogin: 'me',
      assigneeLogins: ['jane'],
      lastCommitAt: '2026-06-01T09:00:00Z',
    });
  });
});

describe('fetchPullRequestReviews', () => {
  it('returns reviews with normalized author and state', async () => {
    const client = createOctokit({ token: 'fake' });
    const reviews = await fetchPullRequestReviews(client, 'org/r', 7);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      state: 'CHANGES_REQUESTED',
      author: { login: 'alice', isBot: false },
      submittedAt: '2026-06-01T10:00:00Z',
    });
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/github-source test fetch-prs`

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `packages/github-source/src/fetch-prs.ts`:

```ts
import type { RawReview } from '@work-summary/core';
import type { GithubClient } from './client.js';

export interface RawPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  authorLogin: string;
  assigneeLogins: string[];
  lastCommitAt: string | null;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo "${repo}", expected "owner/name"`);
  return { owner, repo: name };
}

function isBot(login: string, type: string | undefined): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

export async function fetchOpenPullRequests(client: GithubClient, repo: string): Promise<RawPullRequest[]> {
  const { owner, repo: name } = splitRepo(repo);
  const prs = await client.paginate(client.rest.pulls.list, {
    owner, repo: name, state: 'open', per_page: 100,
  });
  const result: RawPullRequest[] = [];
  for (const p of prs) {
    let lastCommitAt: string | null = null;
    if (p.head?.sha) {
      try {
        const commit = await client.rest.repos.getCommit({ owner, repo: name, ref: p.head.sha });
        lastCommitAt = commit.data.commit.author?.date ?? null;
      } catch {
        lastCommitAt = null;
      }
    }
    result.push({
      number: p.number,
      title: p.title,
      htmlUrl: p.html_url,
      authorLogin: p.user?.login ?? 'ghost',
      assigneeLogins: (p.assignees ?? []).map((a) => a.login),
      lastCommitAt,
    });
  }
  return result;
}

export async function fetchPullRequestReviews(client: GithubClient, repo: string, number: number): Promise<RawReview[]> {
  const { owner, repo: name } = splitRepo(repo);
  const reviews = await client.paginate(client.rest.pulls.listReviews, { owner, repo: name, pull_number: number, per_page: 100 });
  return reviews.map((r) => ({
    state: (r.state as RawReview['state']) ?? 'COMMENTED',
    author: { login: r.user?.login ?? 'ghost', isBot: isBot(r.user?.login ?? '', r.user?.type) },
    submittedAt: r.submitted_at ?? '',
  }));
}
```

Append to `packages/github-source/src/index.ts`:

```ts
export { fetchOpenPullRequests, fetchPullRequestReviews } from './fetch-prs.js';
export type { RawPullRequest } from './fetch-prs.js';
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/github-source test fetch-prs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): fetch open PRs (with head commit ts) and reviews"
```

---

### Task 18: `github-source` - fetch comments (issue + PR review comments)

**Files:**
- Create: `packages/github-source/src/fetch-comments.ts`
- Modify: `packages/github-source/test/msw-server.ts`
- Modify: `packages/github-source/test/fixtures/prs.ts` (add comments fixtures)
- Test: `packages/github-source/src/fetch-comments.test.ts`
- Modify: `packages/github-source/src/index.ts`

**Interfaces:**
- Consumes: `GithubClient`.
- Produces:
  - `fetchIssueComments(client, repo, number, since?): Promise<RawComment[]>` - covers both PR conversation comments and issue comments (same endpoint).
  - `fetchPrReviewComments(client, repo, number, since?): Promise<RawComment[]>` - inline review comments on a PR.

- [ ] **Step 1: Extend fixtures and msw**

Append to `packages/github-source/test/fixtures/prs.ts`:

```ts
export const issueCommentsFixture = [
  { id: 100, body: 'please review', html_url: 'https://gh/c/100', user: { login: 'alice', type: 'User' }, created_at: '2026-06-01T10:30:00Z' },
];

export const prReviewCommentsFixture = [
  { id: 200, body: 'nit: rename', html_url: 'https://gh/c/200', user: { login: 'bob', type: 'User' }, created_at: '2026-06-01T11:30:00Z' },
];
```

Replace `packages/github-source/test/msw-server.ts` with:

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  prListFixture,
  prHeadCommitFixture,
  reviewsFixture,
  issueCommentsFixture,
  prReviewCommentsFixture,
} from './fixtures/prs.js';

export function buildServer() {
  return setupServer(
    http.get('https://api.github.com/repos/:owner/:repo/pulls', () => HttpResponse.json(prListFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/commits/:sha', () => HttpResponse.json(prHeadCommitFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/pulls/:number/reviews', () => HttpResponse.json(reviewsFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/issues/:number/comments', () => HttpResponse.json(issueCommentsFixture)),
    http.get('https://api.github.com/repos/:owner/:repo/pulls/:number/comments', () => HttpResponse.json(prReviewCommentsFixture)),
  );
}
```

- [ ] **Step 2: Write failing test**

Create `packages/github-source/src/fetch-comments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchIssueComments, fetchPrReviewComments } from './fetch-comments.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchIssueComments', () => {
  it('normalizes issue/conversation comments', async () => {
    const client = createOctokit({ token: 'fake' });
    const comments = await fetchIssueComments(client, 'org/r', 7);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      nativeId: '100',
      url: 'https://gh/c/100',
      author: { login: 'alice', isBot: false },
      body: 'please review',
      createdAt: '2026-06-01T10:30:00Z',
    });
  });
});

describe('fetchPrReviewComments', () => {
  it('normalizes inline PR review comments', async () => {
    const client = createOctokit({ token: 'fake' });
    const comments = await fetchPrReviewComments(client, 'org/r', 7);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      nativeId: '200',
      author: { login: 'bob' },
      body: 'nit: rename',
    });
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/github-source test fetch-comments`

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `packages/github-source/src/fetch-comments.ts`:

```ts
import type { RawComment } from '@work-summary/core';
import type { GithubClient } from './client.js';

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo "${repo}"`);
  return { owner, repo: name };
}

function isBot(login: string, type: string | undefined): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

export async function fetchIssueComments(
  client: GithubClient,
  repo: string,
  number: number,
  since?: string,
): Promise<RawComment[]> {
  const { owner, repo: name } = splitRepo(repo);
  const params: { owner: string; repo: string; issue_number: number; per_page: number; since?: string } = {
    owner, repo: name, issue_number: number, per_page: 100,
  };
  if (since) params.since = since;
  const items = await client.paginate(client.rest.issues.listComments, params);
  return items.map((c) => ({
    nativeId: String(c.id),
    url: c.html_url,
    author: { login: c.user?.login ?? 'ghost', isBot: isBot(c.user?.login ?? '', c.user?.type) },
    body: c.body ?? '',
    createdAt: c.created_at,
  }));
}

export async function fetchPrReviewComments(
  client: GithubClient,
  repo: string,
  number: number,
  since?: string,
): Promise<RawComment[]> {
  const { owner, repo: name } = splitRepo(repo);
  const params: { owner: string; repo: string; pull_number: number; per_page: number; since?: string } = {
    owner, repo: name, pull_number: number, per_page: 100,
  };
  if (since) params.since = since;
  const items = await client.paginate(client.rest.pulls.listReviewComments, params);
  return items.map((c) => ({
    nativeId: String(c.id),
    url: c.html_url,
    author: { login: c.user?.login ?? 'ghost', isBot: isBot(c.user?.login ?? '', c.user?.type) },
    body: c.body ?? '',
    createdAt: c.created_at,
  }));
}
```

Append export to `packages/github-source/src/index.ts`:

```ts
export { fetchIssueComments, fetchPrReviewComments } from './fetch-comments.js';
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/github-source test fetch-comments`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): fetch issue and PR review comments"
```

---

### Task 19: `github-source` - fetch mentions via search

**Files:**
- Create: `packages/github-source/src/fetch-mentions.ts`
- Modify: `packages/github-source/test/msw-server.ts`
- Test: `packages/github-source/src/fetch-mentions.test.ts`
- Modify: `packages/github-source/src/index.ts`

**Interfaces:**
- Consumes: `GithubClient`.
- Produces:
  - `fetchMentionedContainers(client, opts: { login; repos: string[]; since?: string }): Promise<Array<{ repo: string; number: number; type: 'pr' | 'issue' }>>`
  - Uses `GET /search/issues?q=mentions:{login}+is:open+repo:r1+repo:r2...&updated:>={since}`.

- [ ] **Step 1: Extend msw**

Replace `buildServer` in `packages/github-source/test/msw-server.ts` to add the search handler. Append inside `setupServer(...)`:

```ts
    http.get('https://api.github.com/search/issues', ({ request }) => {
      const url = new URL(request.url);
      const q = url.searchParams.get('q') ?? '';
      if (!q.includes('mentions:me')) return HttpResponse.json({ total_count: 0, items: [] });
      return HttpResponse.json({
        total_count: 2,
        items: [
          { number: 7, html_url: 'https://github.com/org/r/pull/7', repository_url: 'https://api.github.com/repos/org/r', pull_request: {} },
          { number: 42, html_url: 'https://github.com/org/r/issues/42', repository_url: 'https://api.github.com/repos/org/r' },
        ],
      });
    }),
```

- [ ] **Step 2: Write failing test**

Create `packages/github-source/src/fetch-mentions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { fetchMentionedContainers } from './fetch-mentions.js';
import { buildServer } from '../test/msw-server.js';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchMentionedContainers', () => {
  it('returns containers distinguished by pr/issue', async () => {
    const client = createOctokit({ token: 'fake' });
    const result = await fetchMentionedContainers(client, { login: 'me', repos: ['org/r'] });
    expect(result.sort((a, b) => a.number - b.number)).toEqual([
      { repo: 'org/r', number: 7, type: 'pr' },
      { repo: 'org/r', number: 42, type: 'issue' },
    ]);
  });

  it('returns empty list when login has no mentions', async () => {
    const client = createOctokit({ token: 'fake' });
    const result = await fetchMentionedContainers(client, { login: 'nobody', repos: ['org/r'] });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/github-source test fetch-mentions`

Expected: FAIL.

- [ ] **Step 4: Implement**

Create `packages/github-source/src/fetch-mentions.ts`:

```ts
import type { GithubClient } from './client.js';

export interface MentionRef {
  repo: string;
  number: number;
  type: 'pr' | 'issue';
}

export interface FetchMentionsOptions {
  login: string;
  repos: string[];
  since?: string;
}

function buildQuery(opts: FetchMentionsOptions): string {
  const repoQ = opts.repos.map((r) => `repo:${r}`).join(' ');
  const sinceQ = opts.since ? ` updated:>=${opts.since}` : '';
  return `mentions:${opts.login} is:open ${repoQ}${sinceQ}`.trim();
}

function repoFromUrl(url: string): string {
  const idx = url.indexOf('/repos/');
  if (idx === -1) return '';
  return url.slice(idx + '/repos/'.length);
}

export async function fetchMentionedContainers(
  client: GithubClient,
  opts: FetchMentionsOptions,
): Promise<MentionRef[]> {
  if (opts.repos.length === 0) return [];
  const q = buildQuery(opts);
  const items = await client.paginate(client.rest.search.issuesAndPullRequests, { q, per_page: 100 });
  return items.map((it) => ({
    repo: repoFromUrl(it.repository_url ?? ''),
    number: it.number,
    type: it.pull_request ? ('pr' as const) : ('issue' as const),
  }));
}
```

Append export to `packages/github-source/src/index.ts`:

```ts
export { fetchMentionedContainers } from './fetch-mentions.js';
export type { MentionRef, FetchMentionsOptions } from './fetch-mentions.js';
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/github-source test fetch-mentions`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): fetchMentionedContainers via search API"
```

---

### Task 20: `github-source` - GithubSource (normalize + invoke matchComments)

**Files:**
- Create: `packages/github-source/src/source.ts`
- Test: `packages/github-source/src/source.test.ts`
- Modify: `packages/github-source/src/index.ts`

**Interfaces:**
- Consumes: all previous github-source fetchers; `matchComments` and types from `@work-summary/core`.
- Produces:
  - `interface Source { readonly id: 'github' | 'jira'; fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]>; }`
  - `interface FetchOptions { repos: string[]; userLogin: string; sinceByRepo: Record<string, string | undefined>; defaultSince: string; rules: MatchRulesConfig; filters: BotFilterConfig; concurrency: number; }`
  - `class GithubSource implements Source` - for each repo: list open PRs + (open) issues mentioning user; build `RawContainer[]`; call `matchComments`; return all `PendingComment[]` flattened.

- [ ] **Step 1: Write failing integration test**

Create `packages/github-source/src/source.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createOctokit } from './client.js';
import { GithubSource } from './source.js';
import { buildServer } from '../test/msw-server.js';
import { http, HttpResponse } from 'msw';

const server = buildServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GithubSource.fetchPendingComments', () => {
  it('returns matched pending comments from configured repo', async () => {
    server.use(
      http.get('https://api.github.com/repos/:owner/:repo/issues/42/comments', () =>
        HttpResponse.json([
          { id: 999, body: 'cc @me', html_url: 'https://gh/c/999', user: { login: 'carol', type: 'User' }, created_at: '2026-06-02T10:00:00Z' },
        ]),
      ),
      http.get('https://api.github.com/repos/:owner/:repo/pulls/42/comments', () => HttpResponse.json([])),
    );

    const client = createOctokit({ token: 'fake' });
    const source = new GithubSource(client);
    const result = await source.fetchPendingComments({
      repos: ['org/r'],
      userLogin: 'me',
      sinceByRepo: {},
      defaultSince: '2026-05-01T00:00:00Z',
      rules: {
        authorOfPrUnanswered: true,
        mentioned: true,
        repliedBeforeThenFollowup: true,
        assignee: true,
        changesRequested: true,
      },
      filters: { excludeBots: false, botWhitelist: [] },
      concurrency: 2,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((c) => c.matchedRules.includes('changes_requested'))).toBe(true);
    expect(result.some((c) => c.matchedRules.includes('mentioned'))).toBe(true);
  }, 15000);
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/github-source test source`

Expected: FAIL.

- [ ] **Step 3: Implement source**

Create `packages/github-source/src/source.ts`:

```ts
import pLimit from 'p-limit';
import {
  matchComments,
  type PendingComment,
  type MatchRulesConfig,
  type BotFilterConfig,
  type RawContainer,
  type RawComment,
  type ScanContext,
} from '@work-summary/core';
import type { GithubClient } from './client.js';
import { fetchOpenPullRequests, fetchPullRequestReviews } from './fetch-prs.js';
import { fetchIssueComments, fetchPrReviewComments } from './fetch-comments.js';
import { fetchMentionedContainers, type MentionRef } from './fetch-mentions.js';

export interface FetchOptions {
  repos: string[];
  userLogin: string;
  sinceByRepo: Record<string, string | undefined>;
  defaultSince: string;
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
  concurrency: number;
}

export interface Source {
  readonly id: 'github' | 'jira';
  fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]>;
}

function dedupComments(comments: RawComment[]): RawComment[] {
  const seen = new Set<string>();
  const out: RawComment[] = [];
  for (const c of comments) {
    if (seen.has(c.nativeId)) continue;
    seen.add(c.nativeId);
    out.push(c);
  }
  return out;
}

export class GithubSource implements Source {
  readonly id = 'github' as const;
  constructor(private readonly client: GithubClient) {}

  async fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]> {
    const limit = pLimit(opts.concurrency);
    const perRepo = await Promise.all(
      opts.repos.map((repo) => limit(() => this.scanRepo(repo, opts))),
    );
    return perRepo.flat();
  }

  private async scanRepo(repo: string, opts: FetchOptions): Promise<PendingComment[]> {
    const since = opts.sinceByRepo[repo] ?? opts.defaultSince;
    const [prs, mentions] = await Promise.all([
      fetchOpenPullRequests(this.client, repo),
      fetchMentionedContainers(this.client, { login: opts.userLogin, repos: [repo], since }),
    ]);

    const containers: RawContainer[] = [];

    for (const pr of prs) {
      const [reviews, issueCmt, reviewCmt] = await Promise.all([
        fetchPullRequestReviews(this.client, repo, pr.number),
        fetchIssueComments(this.client, repo, pr.number, since),
        fetchPrReviewComments(this.client, repo, pr.number, since),
      ]);
      containers.push({
        type: 'pr',
        number: pr.number,
        title: pr.title,
        url: pr.htmlUrl,
        authorLogin: pr.authorLogin,
        assigneeLogins: pr.assigneeLogins,
        reviews,
        lastUserCommitAt: pr.lastCommitAt,
        comments: dedupComments([...issueCmt, ...reviewCmt]),
      });
    }

    const prNumbers = new Set(prs.map((p) => p.number));
    const issueMentions: MentionRef[] = mentions.filter((m) => m.type === 'issue' && !prNumbers.has(m.number));
    for (const m of issueMentions) {
      const comments = await fetchIssueComments(this.client, repo, m.number, since);
      containers.push({
        type: 'issue',
        number: m.number,
        title: `#${m.number}`,
        url: `https://github.com/${repo}/issues/${m.number}`,
        authorLogin: 'unknown',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments,
      });
    }

    const ctx: ScanContext = {
      source: 'github',
      repo,
      userLogin: opts.userLogin,
      containers,
    };
    return matchComments(ctx, opts.rules, opts.filters);
  }
}
```

Append export to `packages/github-source/src/index.ts`:

```ts
export { GithubSource } from './source.js';
export type { Source, FetchOptions } from './source.js';
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/github-source test`

Expected: PASS, all github-source tests.

- [ ] **Step 5: Commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): GithubSource composes fetchers + matchComments"
```

---

### Task 21: `cli` - config loader (zod + YAML + env interpolation)

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/config.ts`
- Test: `apps/cli/src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadConfig(path: string, env: NodeJS.ProcessEnv): Config` - reads YAML, interpolates `${VAR}` from `env`, validates via zod, throws `ConfigError` (name === 'ConfigError') on any problem.
  - `interface Config { user; sources; scan; notifications; logging }` matching the spec YAML schema.
  - `class ConfigError extends Error { override readonly name = 'ConfigError' }`.

- [ ] **Step 1: Create app skeleton**

Create `apps/cli/package.json`:

```json
{
  "name": "@work-summary/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "work-summary": "./dist/bin.js" },
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "build": "tsc -p tsconfig.json && chmod +x dist/bin.js",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@work-summary/core": "workspace:*",
    "@work-summary/github-source": "workspace:*",
    "@work-summary/notifiers": "workspace:*",
    "@work-summary/storage": "workspace:*",
    "commander": "^12.1.0",
    "pino": "^9.4.0",
    "pino-pretty": "^11.2.2",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

Create `apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write failing test**

Create `apps/cli/src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, ConfigError } from './config.js';

function writeTmp(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ws-conf-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

const validYaml = `
user:
  githubLogin: me
sources:
  github:
    token: \${GH}
    repos: [org/a]
    rules:
      authorOfPrUnanswered: true
      mentioned: true
      repliedBeforeThenFollowup: true
      assignee: true
      changesRequested: true
    filters:
      excludeBots: true
      botWhitelist: []
scan:
  lookbackDays: 7
  concurrency: 3
notifications:
  - id: primary
    type: smtp
    enabled: true
    smtp:
      host: smtp.test
      port: 587
      secure: false
      user: \${SU}
      pass: \${SP}
    from: a@b
    to: c@d
    subjectTemplate: "[ws] {{count}} - {{date}}"
logging:
  level: info
  file: ~/.local/state/work-summary/scan.log
`;

describe('loadConfig', () => {
  it('parses valid yaml and interpolates env vars', () => {
    const p = writeTmp(validYaml);
    const cfg = loadConfig(p, { GH: 'tok', SU: 'u', SP: 'p' });
    expect(cfg.user.githubLogin).toBe('me');
    expect(cfg.sources.github.token).toBe('tok');
    expect(cfg.notifications[0]?.smtp.user).toBe('u');
  });

  it('throws ConfigError on missing required field', () => {
    const p = writeTmp('user:\n  githubLogin: me\n');
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
  });

  it('throws ConfigError when env var unresolved', () => {
    const p = writeTmp(validYaml);
    expect(() => loadConfig(p, {})).toThrow(/GH/);
  });

  it('throws ConfigError on invalid YAML', () => {
    const p = writeTmp('this: is: not: yaml: ::');
    expect(() => loadConfig(p, {})).toThrow(ConfigError);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/cli test config`

Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

Create `apps/cli/src/config.ts`:

```ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

const RulesSchema = z.object({
  authorOfPrUnanswered: z.boolean(),
  mentioned: z.boolean(),
  repliedBeforeThenFollowup: z.boolean(),
  assignee: z.boolean(),
  changesRequested: z.boolean(),
});

const FiltersSchema = z.object({
  excludeBots: z.boolean(),
  botWhitelist: z.array(z.string()),
});

const SmtpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  user: z.string(),
  pass: z.string(),
});

const NotificationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('smtp'),
  enabled: z.boolean(),
  smtp: SmtpSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  subjectTemplate: z.string().min(1),
});

const ConfigSchema = z.object({
  user: z.object({ githubLogin: z.string().min(1) }),
  sources: z.object({
    github: z.object({
      token: z.string().min(1),
      repos: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).min(1),
      rules: RulesSchema,
      filters: FiltersSchema,
    }),
  }),
  scan: z.object({
    lookbackDays: z.number().int().positive(),
    concurrency: z.number().int().positive(),
  }),
  notifications: z.array(NotificationSchema).min(1),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    file: z.string().min(1),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolate(raw: string, env: NodeJS.ProcessEnv): string {
  const missing: string[] = [];
  const out = raw.replace(ENV_RE, (_, name: string) => {
    const v = env[name];
    if (v === undefined) {
      missing.push(name);
      return '';
    }
    return v;
  });
  if (missing.length > 0) {
    throw new ConfigError(`Unresolved environment variables: ${[...new Set(missing)].join(', ')}`);
  }
  return out;
}

export function loadConfig(path: string, env: NodeJS.ProcessEnv): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`Cannot read config at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const interpolated = interpolate(raw, env);
  let parsed: unknown;
  try {
    parsed = parseYaml(interpolated);
  } catch (err) {
    throw new ConfigError(`Invalid YAML in ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid config: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/cli test config`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): loadConfig (YAML + env interpolation + zod validation)"
```

---

### Task 22: `cli` - logger setup (pino)

**Files:**
- Create: `apps/cli/src/logger.ts`
- Test: `apps/cli/src/logger.test.ts`

**Interfaces:**
- Consumes: `Config['logging']`.
- Produces:
  - `createLogger(opts: { level: 'debug'|'info'|'warn'|'error'; file: string; runId?: number; jsonOnly?: boolean }): pino.Logger`
  - Writes structured JSON to `file`; pretty-prints to stderr when TTY and not `jsonOnly`.
  - When `runId` provided, every log line includes `runId` field.

- [ ] **Step 1: Write failing test**

Create `apps/cli/src/logger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('writes JSON lines to file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ws-log-')), 'scan.log');
    const log = createLogger({ level: 'info', file, jsonOnly: true });
    log.info({ a: 1 }, 'hello');
    await new Promise((r) => setTimeout(r, 50));
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('"msg":"hello"');
    expect(content).toContain('"a":1');
  });

  it('tags every line with runId when provided', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ws-log-')), 'scan.log');
    const log = createLogger({ level: 'info', file, runId: 42, jsonOnly: true });
    log.info('hi');
    await new Promise((r) => setTimeout(r, 50));
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('"runId":42');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/cli test logger`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/cli/src/logger.ts`:

```ts
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino, { type Logger } from 'pino';

function expandHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, homedir()) : p;
}

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  file: string;
  runId?: number;
  jsonOnly?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const file = expandHome(opts.file);
  mkdirSync(dirname(file), { recursive: true });

  const fileStream = pino.destination({ dest: file, append: true, sync: false });
  const streams: { stream: NodeJS.WritableStream; level?: pino.Level }[] = [{ stream: fileStream }];

  const wantPretty = !opts.jsonOnly && process.stderr.isTTY;
  if (wantPretty) {
    const pretty = pino.transport({ target: 'pino-pretty', options: { destination: 2, colorize: true } });
    streams.push({ stream: pretty });
  } else if (!opts.jsonOnly) {
    streams.push({ stream: process.stderr });
  }

  const base = opts.runId !== undefined ? { runId: opts.runId } : {};
  return pino({ level: opts.level, base }, pino.multistream(streams));
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/cli test logger`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): pino logger with runId tag and file+stderr streams"
```

---

### Task 23: `cli` - `init` command

**Files:**
- Create: `apps/cli/src/commands/init.ts`
- Create: `apps/cli/src/paths.ts`
- Test: `apps/cli/src/commands/init.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `runInit(opts: { configPath: string; stateDir: string; force?: boolean }): { written: boolean; configPath: string; stateDir: string }`
  - Writes a templated `config.yaml` (commented placeholders) and creates the state dir. Throws if `config.yaml` exists and `force` is not set.
  - `paths.ts` exports `defaultConfigPath()` and `defaultStateDir()` using XDG dirs with `~` fallback.

- [ ] **Step 1: Write failing test**

Create `apps/cli/src/commands/init.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from './init.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ws-init-'));
});

describe('runInit', () => {
  it('creates config file and state dir on fresh system', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    const res = runInit({ configPath: cfg, stateDir: state });
    expect(res.written).toBe(true);
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(state)).toBe(true);
    expect(readFileSync(cfg, 'utf8')).toContain('githubLogin');
  });

  it('throws when config exists and force=false', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    runInit({ configPath: cfg, stateDir: state });
    expect(() => runInit({ configPath: cfg, stateDir: state })).toThrow(/already exists/);
  });

  it('overwrites when force=true', () => {
    const cfg = join(tmp, 'config.yaml');
    const state = join(tmp, 'state');
    runInit({ configPath: cfg, stateDir: state });
    const res = runInit({ configPath: cfg, stateDir: state, force: true });
    expect(res.written).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/cli test init`

Expected: FAIL.

- [ ] **Step 3: Implement paths and init**

Create `apps/cli/src/paths.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

function xdg(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  if (v && v.length > 0) return v;
  return join(homedir(), fallback);
}

export function defaultConfigPath(): string {
  return join(xdg('XDG_CONFIG_HOME', '.config'), 'work-summary', 'config.yaml');
}

export function defaultStateDir(): string {
  return join(xdg('XDG_STATE_HOME', '.local/state'), 'work-summary');
}

export function defaultDbPath(): string {
  return join(defaultStateDir(), 'state.db');
}
```

Create `apps/cli/src/commands/init.ts`:

```ts
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const CONFIG_TEMPLATE = `# work-summary configuration
user:
  githubLogin: your-github-login

sources:
  github:
    token: \${GITHUB_TOKEN}
    repos:
      - org/repo-foo
      - org/repo-bar
    rules:
      authorOfPrUnanswered: true
      mentioned: true
      repliedBeforeThenFollowup: true
      assignee: true
      changesRequested: true
    filters:
      excludeBots: true
      botWhitelist: []

scan:
  lookbackDays: 7
  concurrency: 3

notifications:
  - id: primary-email
    type: smtp
    enabled: true
    smtp:
      host: smtp.gmail.com
      port: 587
      secure: false
      user: \${SMTP_USER}
      pass: \${SMTP_PASS}
    from: "Work Summary <me@example.com>"
    to: me@example.com
    subjectTemplate: "[work-summary] {{count}} new comments - {{date}}"

logging:
  level: info
  file: ~/.local/state/work-summary/scan.log
`;

export interface InitOptions {
  configPath: string;
  stateDir: string;
  force?: boolean;
}

export function runInit(opts: InitOptions): { written: boolean; configPath: string; stateDir: string } {
  if (existsSync(opts.configPath) && !opts.force) {
    throw new Error(`Config already exists at ${opts.configPath} (use --force to overwrite)`);
  }
  mkdirSync(dirname(opts.configPath), { recursive: true });
  mkdirSync(opts.stateDir, { recursive: true });
  writeFileSync(opts.configPath, CONFIG_TEMPLATE);
  return { written: true, configPath: opts.configPath, stateDir: opts.stateDir };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/cli test init`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): init command (writes starter config, creates state dir)"
```

---

### Task 24: `cli` - `doctor` command

**Files:**
- Create: `apps/cli/src/commands/doctor.ts`
- Test: `apps/cli/src/commands/doctor.test.ts`

**Interfaces:**
- Consumes: `Config`, `GithubClient`, `SmtpNotifier`, `openDatabase`, `runMigrations`.
- Produces:
  - `runDoctor(opts: { config: Config; deps: DoctorDeps }): Promise<DoctorResult>`
  - `interface DoctorDeps { makeOctokit: (token: string) => GithubClient; makeSmtp: (opts: SmtpOptions) => { verify(): Promise<void> }; openDb: (path: string) => SqliteDatabase; dbPath: string; }`
  - `interface DoctorResult { checks: Array<{ name: string; ok: boolean; message?: string }>; allOk: boolean }`

- [ ] **Step 1: Write failing test**

Create `apps/cli/src/commands/doctor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runDoctor } from './doctor.js';
import type { Config } from '../config.js';

const cfg: Config = {
  user: { githubLogin: 'me' },
  sources: {
    github: {
      token: 't', repos: ['org/r'],
      rules: { authorOfPrUnanswered: true, mentioned: true, repliedBeforeThenFollowup: true, assignee: true, changesRequested: true },
      filters: { excludeBots: false, botWhitelist: [] },
    },
  },
  scan: { lookbackDays: 7, concurrency: 3 },
  notifications: [{
    id: 'n', type: 'smtp', enabled: true,
    smtp: { host: 'h', port: 25, secure: false, user: 'u', pass: 'p' },
    from: 'a', to: 'b', subjectTemplate: 's',
  }],
  logging: { level: 'info', file: '/tmp/x.log' },
};

const okDeps = {
  makeOctokit: () => ({ rest: { users: { getAuthenticated: async () => ({ data: { login: 'me' } }) } } } as never),
  makeSmtp: () => ({ verify: async () => undefined }),
  openDb: () => ({ pragma: () => undefined, exec: () => undefined, prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }) } as never),
  dbPath: ':memory:',
};

describe('runDoctor', () => {
  it('returns all checks ok when deps succeed', async () => {
    const r = await runDoctor({ config: cfg, deps: okDeps });
    expect(r.allOk).toBe(true);
    expect(r.checks.find((c) => c.name === 'github')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'smtp')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'storage')?.ok).toBe(true);
  });

  it('reports github failure on auth error', async () => {
    const r = await runDoctor({
      config: cfg,
      deps: {
        ...okDeps,
        makeOctokit: () => ({ rest: { users: { getAuthenticated: () => Promise.reject(new Error('401')) } } } as never),
      },
    });
    expect(r.allOk).toBe(false);
    expect(r.checks.find((c) => c.name === 'github')?.ok).toBe(false);
  });

  it('reports smtp failure', async () => {
    const r = await runDoctor({
      config: cfg,
      deps: { ...okDeps, makeSmtp: () => ({ verify: () => Promise.reject(new Error('refused')) }) },
    });
    expect(r.checks.find((c) => c.name === 'smtp')?.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @work-summary/cli test doctor`

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/cli/src/commands/doctor.ts`:

```ts
import type { Config } from '../config.js';

export interface DoctorCheck {
  name: 'config' | 'github' | 'smtp' | 'storage';
  ok: boolean;
  message?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  allOk: boolean;
}

export interface DoctorDeps {
  makeOctokit: (token: string) => { rest: { users: { getAuthenticated: () => Promise<{ data: { login: string } }> } } };
  makeSmtp: (opts: Config['notifications'][number]['smtp'] & { from: string; to: string }) => { verify: () => Promise<void> };
  openDb: (path: string) => { pragma: (s: string) => unknown; exec: (s: string) => void; prepare: (s: string) => { all: () => unknown[]; get: () => unknown; run: () => void } };
  dbPath: string;
}

export async function runDoctor(args: { config: Config; deps: DoctorDeps }): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [{ name: 'config', ok: true }];

  try {
    const client = args.deps.makeOctokit(args.config.sources.github.token);
    const me = await client.rest.users.getAuthenticated();
    checks.push({ name: 'github', ok: true, message: `Authenticated as ${me.data.login}` });
  } catch (err) {
    checks.push({ name: 'github', ok: false, message: err instanceof Error ? err.message : String(err) });
  }

  for (const n of args.config.notifications) {
    if (!n.enabled) continue;
    try {
      const smtp = args.deps.makeSmtp({ ...n.smtp, from: n.from, to: n.to });
      await smtp.verify();
      checks.push({ name: 'smtp', ok: true, message: `${n.smtp.host}:${n.smtp.port}` });
    } catch (err) {
      checks.push({ name: 'smtp', ok: false, message: err instanceof Error ? err.message : String(err) });
    }
    break;
  }

  try {
    const db = args.deps.openDb(args.deps.dbPath);
    db.pragma('user_version');
    checks.push({ name: 'storage', ok: true, message: args.deps.dbPath });
  } catch (err) {
    checks.push({ name: 'storage', ok: false, message: err instanceof Error ? err.message : String(err) });
  }

  return { checks, allOk: checks.every((c) => c.ok) };
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @work-summary/cli test doctor`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): doctor command (config, github, smtp, storage checks)"
```

---

### Task 25: `cli` - `scan` command + commander wiring

**Files:**
- Create: `apps/cli/src/commands/scan.ts`
- Create: `apps/cli/src/bin.ts`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/exit-codes.ts`
- Test: `apps/cli/src/commands/scan.test.ts`

**Interfaces:**
- Consumes: everything from previous tasks.
- Produces:
  - `runScan(args: { config: Config; deps: ScanDeps; dryRun: boolean; now: () => Date }): Promise<{ exitCode: number; newComments: number }>`
  - `interface ScanDeps { source: Source; notifier: Notifier; db: SqliteDatabase; logger: Logger; }`
  - `exit-codes.ts` exports `EXIT = { OK: 0, UNEXPECTED: 1, CONFIG: 2, AUTH: 3, SMTP: 4, STORAGE: 5, DRY_RUN_WOULD_SEND: 10 }`.
  - `bin.ts` is the commander entry: subcommands `init`, `doctor`, `scan` (default).

- [ ] **Step 1: Write exit codes**

Create `apps/cli/src/exit-codes.ts`:

```ts
export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  CONFIG: 2,
  AUTH: 3,
  SMTP: 4,
  STORAGE: 5,
  DRY_RUN_WOULD_SEND: 10,
} as const;
```

- [ ] **Step 2: Write failing test for scan pipeline**

Create `apps/cli/src/commands/scan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runScan } from './scan.js';
import { openDatabase, runMigrations, createCommentsRepo, createRunsRepo, createWatermarksRepo } from '@work-summary/storage';
import pino from 'pino';
import type { PendingComment } from '@work-summary/core';
import type { Config } from '../config.js';

function sampleComment(id: string): PendingComment {
  return {
    id, source: 'github', repo: 'org/r', containerType: 'pr', containerNumber: 1,
    containerTitle: '', containerUrl: '', commentId: id, commentUrl: '',
    author: { login: 'a', isBot: false }, body: '', createdAt: '2026-06-01T00:00:00Z',
    matchedRules: ['mentioned'],
  };
}

function baseConfig(): Config {
  return {
    user: { githubLogin: 'me' },
    sources: {
      github: {
        token: 't', repos: ['org/r'],
        rules: { authorOfPrUnanswered: true, mentioned: true, repliedBeforeThenFollowup: true, assignee: true, changesRequested: true },
        filters: { excludeBots: false, botWhitelist: [] },
      },
    },
    scan: { lookbackDays: 7, concurrency: 1 },
    notifications: [{
      id: 'n', type: 'smtp', enabled: true,
      smtp: { host: 'h', port: 25, secure: false, user: '', pass: '' },
      from: 'a', to: 'b', subjectTemplate: '[ws] {{count}} - {{date}}',
    }],
    logging: { level: 'silent' as never, file: '/tmp/x.log' },
  };
}

function makeDeps(comments: PendingComment[], sendImpl: (c: PendingComment[]) => Promise<void> = async () => undefined) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return {
    db,
    commentsRepo: createCommentsRepo(db),
    runsRepo: createRunsRepo(db, () => new Date('2026-06-01T00:00:00Z')),
    watermarksRepo: createWatermarksRepo(db),
    source: { id: 'github' as const, fetchPendingComments: () => Promise.resolve(comments) },
    notifier: { id: 'smtp', send: async (p: { comments: PendingComment[] }) => sendImpl(p.comments) },
    logger: pino({ level: 'silent' }),
  };
}

describe('runScan', () => {
  it('sends and marks notified on first run', async () => {
    const deps = makeDeps([sampleComment('a'), sampleComment('b')]);
    const r = await runScan({ config: baseConfig(), deps, dryRun: false, now: () => new Date('2026-06-01T00:00:00Z') });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(2);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a'), sampleComment('b')])).toEqual([]);
  });

  it('exits 0 with 0 new when nothing matches', async () => {
    const deps = makeDeps([]);
    const r = await runScan({ config: baseConfig(), deps, dryRun: false, now: () => new Date('2026-06-01T00:00:00Z') });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(0);
  });

  it('dedups: second run with same comments sends nothing', async () => {
    const cfg = baseConfig();
    const deps1 = makeDeps([sampleComment('a')]);
    await runScan({ config: cfg, deps: deps1, dryRun: false, now: () => new Date('2026-06-01T00:00:00Z') });

    let sent = 0;
    const deps2 = {
      ...deps1,
      source: { id: 'github' as const, fetchPendingComments: () => Promise.resolve([sampleComment('a')]) },
      notifier: { id: 'smtp', send: async () => { sent++; } },
    };
    const r = await runScan({ config: cfg, deps: deps2, dryRun: false, now: () => new Date('2026-06-02T00:00:00Z') });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(0);
    expect(sent).toBe(0);
  });

  it('exits 10 on dry-run and does NOT mark notified', async () => {
    const deps = makeDeps([sampleComment('a')]);
    const r = await runScan({ config: baseConfig(), deps, dryRun: true, now: () => new Date('2026-06-01T00:00:00Z') });
    expect(r.exitCode).toBe(10);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a')])).toHaveLength(1);
  });

  it('exits 4 on SMTP failure and does NOT mark notified', async () => {
    const deps = makeDeps([sampleComment('a')], () => Promise.reject(Object.assign(new Error('refused'), { name: 'SmtpError' })));
    const r = await runScan({ config: baseConfig(), deps, dryRun: false, now: () => new Date('2026-06-01T00:00:00Z') });
    expect(r.exitCode).toBe(4);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a')])).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test, verify failure**

Run: `pnpm --filter @work-summary/cli test scan`

Expected: FAIL.

- [ ] **Step 4: Implement runScan**

Create `apps/cli/src/commands/scan.ts`:

```ts
import type { Logger } from 'pino';
import type { PendingComment } from '@work-summary/core';
import type { Source } from '@work-summary/github-source';
import type { Notifier, NotificationPayload } from '@work-summary/notifiers';
import type { CommentsRepo, RunsRepo, WatermarksRepo, SqliteDatabase } from '@work-summary/storage';
import type { Config } from '../config.js';
import { EXIT } from '../exit-codes.js';

export interface ScanDeps {
  db: SqliteDatabase;
  commentsRepo: CommentsRepo;
  runsRepo: RunsRepo;
  watermarksRepo: WatermarksRepo;
  source: Source;
  notifier: Notifier;
  logger: Logger;
}

function renderSubject(template: string, count: number, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return template.replace(/\{\{count\}\}/g, String(count)).replace(/\{\{date\}\}/g, `${yyyy}-${mm}-${dd}`);
}

function isSmtpError(err: unknown): boolean {
  return err instanceof Error && err.name === 'SmtpError';
}

export interface RunScanArgs {
  config: Config;
  deps: ScanDeps;
  dryRun: boolean;
  now: () => Date;
}

export async function runScan(args: RunScanArgs): Promise<{ exitCode: number; newComments: number }> {
  const { config, deps, dryRun, now } = args;
  const runId = deps.runsRepo.startRun();
  const log = deps.logger.child({ runId });

  const lookbackMs = config.scan.lookbackDays * 24 * 60 * 60 * 1000;
  const defaultSince = new Date(now().getTime() - lookbackMs).toISOString();
  const sinceByRepo: Record<string, string | undefined> = {};
  for (const repo of config.sources.github.repos) {
    const wm = deps.watermarksRepo.get('github', repo);
    if (wm) sinceByRepo[repo] = wm;
  }

  let fetched: PendingComment[];
  try {
    fetched = await deps.source.fetchPendingComments({
      repos: config.sources.github.repos,
      userLogin: config.user.githubLogin,
      sinceByRepo,
      defaultSince,
      rules: config.sources.github.rules,
      filters: config.sources.github.filters,
      concurrency: config.scan.concurrency,
    });
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'failed', {
      commentsFound: 0, commentsNotified: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    log.error({ err }, 'Source fetch failed');
    return { exitCode: EXIT.UNEXPECTED, newComments: 0 };
  }

  const newComments = deps.commentsRepo.filterUnnotified(fetched);

  if (newComments.length === 0) {
    deps.runsRepo.finishRun(runId, 'success', { commentsFound: fetched.length, commentsNotified: 0 });
    for (const repo of config.sources.github.repos) deps.watermarksRepo.set('github', repo, now().toISOString());
    log.info({ found: fetched.length }, 'No new comments');
    return { exitCode: EXIT.OK, newComments: 0 };
  }

  const notif = config.notifications.find((n) => n.enabled);
  if (!notif) {
    deps.runsRepo.finishRun(runId, 'failed', { commentsFound: fetched.length, commentsNotified: 0, errorMessage: 'No enabled notifier' });
    return { exitCode: EXIT.CONFIG, newComments: newComments.length };
  }

  const payload: NotificationPayload = {
    subject: renderSubject(notif.subjectTemplate, newComments.length, now()),
    comments: newComments,
    generatedAt: now().toISOString(),
  };

  if (dryRun) {
    deps.runsRepo.finishRun(runId, 'success', { commentsFound: fetched.length, commentsNotified: 0 });
    log.info({ would: newComments.length }, 'Dry-run');
    return { exitCode: EXIT.DRY_RUN_WOULD_SEND, newComments: newComments.length };
  }

  try {
    await deps.notifier.send(payload);
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'failed', {
      commentsFound: fetched.length, commentsNotified: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    log.error({ err }, 'Notifier send failed');
    return { exitCode: isSmtpError(err) ? EXIT.SMTP : EXIT.UNEXPECTED, newComments: newComments.length };
  }

  try {
    deps.commentsRepo.markAsNotified(newComments, now().toISOString());
    for (const repo of config.sources.github.repos) deps.watermarksRepo.set('github', repo, now().toISOString());
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'partial', {
      commentsFound: fetched.length, commentsNotified: newComments.length,
      errorMessage: 'Storage failure after send',
    });
    log.error({ err }, 'Storage write failed after send');
    return { exitCode: EXIT.STORAGE, newComments: newComments.length };
  }

  deps.runsRepo.finishRun(runId, 'success', {
    commentsFound: fetched.length,
    commentsNotified: newComments.length,
  });
  log.info({ sent: newComments.length }, 'Digest sent');
  return { exitCode: EXIT.OK, newComments: newComments.length };
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @work-summary/cli test scan`

Expected: PASS, 5 tests.

- [ ] **Step 6: Wire commander entry**

Create `apps/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runScan } from './commands/scan.js';
import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './logger.js';
import { defaultConfigPath, defaultStateDir, defaultDbPath } from './paths.js';
import { createOctokit } from '@work-summary/github-source';
import { GithubSource } from '@work-summary/github-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import { openDatabase, runMigrations, createCommentsRepo, createRunsRepo, createWatermarksRepo } from '@work-summary/storage';
import { EXIT } from './exit-codes.js';

const program = new Command();
program.name('work-summary').description('Centralize pending PR/issue comments awaiting your response').version('0.1.0');

program
  .command('init')
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .option('--force', 'overwrite existing config', false)
  .action((opts: { config: string; force: boolean }) => {
    try {
      const r = runInit({ configPath: opts.config, stateDir: defaultStateDir(), force: opts.force });
      process.stdout.write(`OK Wrote config to ${r.configPath}\nOK Created state dir at ${r.stateDir}\n`);
      process.exit(EXIT.OK);
    } catch (err) {
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program
  .command('doctor')
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .action(async (opts: { config: string }) => {
    try {
      const cfg = loadConfig(opts.config, process.env);
      const r = await runDoctor({
        config: cfg,
        deps: {
          makeOctokit: (token) => createOctokit({ token }),
          makeSmtp: (smtpOpts) => new SmtpNotifier(smtpOpts),
          openDb: (p) => openDatabase(p),
          dbPath: defaultDbPath(),
        },
      });
      for (const c of r.checks) process.stdout.write(`${c.ok ? 'OK' : 'FAIL'} ${c.name}${c.message ? ': ' + c.message : ''}\n`);
      process.exit(r.allOk ? EXIT.OK : EXIT.AUTH);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`config error: ${err.message}\n`);
        process.exit(EXIT.CONFIG);
      }
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program
  .command('scan', { isDefault: true })
  .option('-c, --config <path>', 'config path', defaultConfigPath())
  .option('--dry-run', 'do not send or mark notified', false)
  .option('--json', 'log JSON only (no pretty)', false)
  .option('--debug', 'verbose debug logging', false)
  .action(async (opts: { config: string; dryRun: boolean; json: boolean; debug: boolean }) => {
    try {
      const cfg = loadConfig(opts.config, process.env);
      const logger = createLogger({
        level: opts.debug ? 'debug' : cfg.logging.level,
        file: cfg.logging.file,
        jsonOnly: opts.json,
      });
      const db = openDatabase(defaultDbPath());
      runMigrations(db);
      const client = createOctokit({ token: cfg.sources.github.token });
      const source = new GithubSource(client);
      const notif = cfg.notifications.find((n) => n.enabled);
      if (!notif) {
        process.stderr.write('No enabled notifier in config\n');
        process.exit(EXIT.CONFIG);
      }
      const notifier = new SmtpNotifier({ ...notif.smtp, from: notif.from, to: notif.to });
      const r = await runScan({
        config: cfg,
        deps: {
          db,
          commentsRepo: createCommentsRepo(db),
          runsRepo: createRunsRepo(db, () => new Date()),
          watermarksRepo: createWatermarksRepo(db),
          source,
          notifier,
          logger,
        },
        dryRun: opts.dryRun,
        now: () => new Date(),
      });
      process.exit(r.exitCode);
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`config error: ${err.message}\n`);
        process.exit(EXIT.CONFIG);
      }
      process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT.UNEXPECTED);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(EXIT.UNEXPECTED);
});
```

Create `apps/cli/src/index.ts`:

```ts
export { runInit } from './commands/init.js';
export { runDoctor } from './commands/doctor.js';
export { runScan } from './commands/scan.js';
export { loadConfig, ConfigError } from './config.js';
export { createLogger } from './logger.js';
export { EXIT } from './exit-codes.js';
```

- [ ] **Step 7: Verify everything builds**

Run: `pnpm -r build && pnpm -r test`

Expected: PASS, all packages and all tests.

- [ ] **Step 8: Commit**

```bash
git add apps/cli
git commit -m "feat(cli): scan command + commander wiring (init/doctor/scan)"
```

---

### Task 26: README and cron setup docs

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: user-facing installation, configuration, and cron-setup documentation.

- [ ] **Step 1: Write README**

Replace `README.md` with:

````markdown
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

| Key | Description |
|---|---|
| `authorOfPrUnanswered` | A comment from someone else on a PR I authored, with no reply from me since |
| `mentioned` | A comment that @-mentions my login (word boundary, case insensitive) |
| `repliedBeforeThenFollowup` | I commented earlier in the thread; someone followed up after my last comment |
| `assignee` | I am an assignee on the PR/issue and a comment has no reply from me since |
| `changesRequested` | A reviewer left a CHANGES_REQUESTED review on my PR; I have not pushed a commit or replied |

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

| Code | Meaning |
|---:|---|
| 0 | Success (digest sent or nothing new) |
| 1 | Unexpected error |
| 2 | Invalid config |
| 3 | GitHub auth failure |
| 4 | SMTP failure |
| 5 | Storage IO failure |
| 10 | Dry-run would-send |

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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with install, commands, scheduling, troubleshooting"
```

- [ ] **Step 3: Final integration check**

Run:

```bash
pnpm -r build
pnpm -r test
pnpm -r lint
```

Expected: every command exits 0. Push the branch:

```bash
git push origin main
```

---

## Self-Review Checklist

After implementing, verify:

- **Spec coverage:** Every requirement from `docs/superpowers/specs/2026-06-29-phase1-core-scanner-design.md` sections 1-14 has a task. Sections 15 (epics) and 16 (open questions) are out of scope for the plan.
- **Exit codes match spec section 9:** 0, 1, 2, 3, 4, 5, 10 - covered by `EXIT` in Task 25.
- **No em-dashes anywhere** in the plan or generated code/text - use hyphens (-).
- **Type names consistent across tasks:** `PendingComment`, `RawComment`, `RawContainer`, `RawReview`, `ScanContext`, `MatchRulesConfig`, `BotFilterConfig`, `NotificationPayload`, `Notifier`, `Source`, `FetchOptions`, `CommentsRepo`, `RunsRepo`, `WatermarksRepo`, `SqliteDatabase`, `Config`, `ConfigError`, `SmtpError`, `EXIT`.
- **Atomic ordering:** `send()` precedes `markAsNotified()` and watermark updates in Task 25 - confirmed.
- **Bot filter** integrated in Task 8 before `GithubSource` consumes it in Task 20 - order correct.
- **No placeholders:** no `TBD`, `TODO`, `similar to Task N`, or "add error handling" - confirmed.





