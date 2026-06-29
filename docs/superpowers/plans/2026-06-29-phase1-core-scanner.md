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

