# Phase 4 - JIRA Source Integration - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pull pending JIRA comments alongside GitHub comments using the same `Source` interface, with UI-managed sites/projects.

**Architecture:** New `packages/jira-source` implementing Source. JIRA REST v3 via undici. ADF body converted to plain text. New tables jira_site + jira_project + notified_comments.issue_key. API and Web extended.

**Tech Stack:** undici (already in monorepo), zod, vitest fetch mocking.

## Global Constraints
- Reuse encryption service from Phase 2 (`packages/auth` exports `EncryptionService`).
- Reuse `NotifiedComment` shape from Phase 1 (`@work-summary/storage`).
- Throttle JIRA calls: 100ms between comment fetches, exponential backoff on 429.
- JIRA Cloud only.
- API responses must redact `encrypted_token`.

---

### Task 1: Migration 0004

**Files:**
- Create: `packages/storage/src/migrations/0004_jira.sql`
- Modify: `packages/storage/src/db.ts`
- Test: `packages/storage/test/migration-0004.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('creates jira_site and jira_project, adds issue_key', () => {
  const db = initDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map((r:any) => r.name);
  expect(tables).toContain('jira_site');
  expect(tables).toContain('jira_project');
  const cols = db.prepare("PRAGMA table_info(notified_comments)").all() as any[];
  expect(cols.find(c => c.name === 'issue_key')).toBeTruthy();
});
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: SQL** (full content from spec section 4)

- [ ] **Step 4: Tests pass; commit**

```bash
git add packages/storage
git commit -m "feat(storage): migration 0004 (jira_site + jira_project + issue_key)"
```

---

### Task 2: Jira repositories

**Files:**
- Create: `packages/storage/src/jira-site-repository.ts`, `packages/storage/src/jira-project-repository.ts`
- Test: `packages/storage/test/jira-repositories.test.ts`

**Interfaces:**
- Produces:
```ts
export interface JiraSiteRow {
  id: string; baseUrl: string; email: string; encryptedToken: string;
  developerFieldId: string | null; enabled: boolean;
  createdAt: string; updatedAt: string;
}
export class JiraSiteRepository {
  constructor(db: Database.Database);
  list(): JiraSiteRow[]; get(id: string): JiraSiteRow | null;
  insert(row: Omit<JiraSiteRow,'createdAt'|'updatedAt'>): JiraSiteRow;
  update(id: string, patch: Partial<JiraSiteRow>): JiraSiteRow;
  delete(id: string): void;
}
export interface JiraProjectRow {
  id: number; siteId: string; projectKey: string; projectName: string;
}
export class JiraProjectRepository {
  constructor(db: Database.Database);
  listBySite(siteId: string): JiraProjectRow[];
  replaceForSite(siteId: string, projects: { projectKey: string; projectName: string }[]): JiraProjectRow[];
}
```

- [ ] **Step 1: Failing test**

```ts
it('replaceForSite is transactional', () => {
  const repo = new JiraProjectRepository(db);
  repo.replaceForSite('site1', [{ projectKey:'WS', projectName:'Work Summary' }]);
  repo.replaceForSite('site1', [{ projectKey:'WS', projectName:'Work Summary' },
                                 { projectKey:'OTHER', projectName:'Other' }]);
  expect(repo.listBySite('site1').map(p => p.projectKey).sort()).toEqual(['OTHER','WS']);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// jira-site-repository.ts - mirrors ScheduleRepository pattern from Phase 3
import type Database from 'better-sqlite3';
export class JiraSiteRepository {
  constructor(private db: Database.Database) {}
  private parse(r: any): JiraSiteRow {
    return { id: r.id, baseUrl: r.base_url, email: r.email,
      encryptedToken: r.encrypted_token, developerFieldId: r.developer_field_id,
      enabled: r.enabled === 1, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  list() { return this.db.prepare('SELECT * FROM jira_site ORDER BY base_url').all().map((r:any)=>this.parse(r)); }
  get(id: string) {
    const r = this.db.prepare('SELECT * FROM jira_site WHERE id=?').get(id);
    return r ? this.parse(r) : null;
  }
  insert(row: Omit<JiraSiteRow,'createdAt'|'updatedAt'>): JiraSiteRow {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO jira_site
      (id,base_url,email,encrypted_token,developer_field_id,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      row.id, row.baseUrl, row.email, row.encryptedToken, row.developerFieldId,
      row.enabled?1:0, now, now);
    return this.get(row.id)!;
  }
  update(id: string, patch: Partial<JiraSiteRow>): JiraSiteRow {
    const cur = this.get(id);
    if (!cur) throw new Error(`Site ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`UPDATE jira_site SET
      base_url=?, email=?, encrypted_token=?, developer_field_id=?, enabled=?, updated_at=?
      WHERE id=?`).run(
      next.baseUrl, next.email, next.encryptedToken, next.developerFieldId,
      next.enabled?1:0, next.updatedAt, id);
    return this.get(id)!;
  }
  delete(id: string) { this.db.prepare('DELETE FROM jira_site WHERE id=?').run(id); }
}

// jira-project-repository.ts
export class JiraProjectRepository {
  constructor(private db: Database.Database) {}
  listBySite(siteId: string): JiraProjectRow[] {
    return this.db.prepare('SELECT * FROM jira_project WHERE site_id=? ORDER BY project_key')
      .all(siteId).map((r:any)=>({
        id: r.id, siteId: r.site_id, projectKey: r.project_key, projectName: r.project_name
      }));
  }
  replaceForSite(siteId: string, projects: { projectKey: string; projectName: string }[]) {
    const tx = this.db.transaction((sid: string, projs: typeof projects) => {
      this.db.prepare('DELETE FROM jira_project WHERE site_id=?').run(sid);
      const stmt = this.db.prepare(
        'INSERT INTO jira_project (site_id, project_key, project_name) VALUES (?,?,?)');
      for (const p of projs) stmt.run(sid, p.projectKey, p.projectName);
    });
    tx(siteId, projects);
    return this.listBySite(siteId);
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): JiraSiteRepository + JiraProjectRepository"
```

---

### Task 3: ADF -> plain text converter

**Files:**
- Create: `packages/jira-source/package.json`, `src/index.ts`, `src/adf.ts`
- Test: `packages/jira-source/test/adf.test.ts`

**Interfaces:**
- Produces: `export function adfToText(doc: AdfDoc): string`

- [ ] **Step 1: Failing test**

```ts
import { adfToText } from '../src/adf';

it('handles paragraphs and text', () => {
  const doc = { type:'doc', content:[
    { type:'paragraph', content:[{ type:'text', text:'Hello world' }]},
    { type:'paragraph', content:[{ type:'text', text:'Second line' }]},
  ]};
  expect(adfToText(doc).trim()).toBe('Hello world\n\nSecond line');
});

it('renders mentions as @name', () => {
  const doc = { type:'doc', content:[
    { type:'paragraph', content:[
      { type:'text', text:'cc ' },
      { type:'mention', attrs:{ text:'@jpaulo', id:'u1' }},
    ]}
  ]};
  expect(adfToText(doc).trim()).toBe('cc @jpaulo');
});

it('ignores unknown leaf nodes', () => {
  const doc = { type:'doc', content:[
    { type:'paragraph', content:[
      { type:'text', text:'A ' },
      { type:'emoji', attrs:{ shortName:':smile:' }},
      { type:'text', text:' B' },
    ]}
  ]};
  expect(adfToText(doc).trim()).toBe('A  B');
});
```

- [ ] **Step 2: Setup package + fail**

```json
// package.json
{
  "name": "@work-summary/jira-source",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": {
    "undici": "^6.0.0",
    "@work-summary/core": "workspace:*",
    "@work-summary/storage": "workspace:*",
    "@work-summary/auth": "workspace:*"
  },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.4.0" }
}
```

- [ ] **Step 3: Implementation**

```ts
// packages/jira-source/src/adf.ts
type AdfNode = { type: string; text?: string; attrs?: any; content?: AdfNode[] };

export function adfToText(doc: AdfNode | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  walk(doc, out);
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

function walk(node: AdfNode, out: string[]) {
  switch (node.type) {
    case 'doc':
      for (const c of node.content ?? []) walk(c, out);
      return;
    case 'paragraph':
      for (const c of node.content ?? []) walk(c, out);
      out.push('\n\n');
      return;
    case 'text':
      out.push(node.text ?? '');
      return;
    case 'mention':
      out.push(`@${(node.attrs?.text ?? node.attrs?.displayName ?? 'user').replace(/^@/, '')}`);
      return;
    case 'hardBreak':
      out.push('\n');
      return;
    default:
      for (const c of node.content ?? []) walk(c, out);
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add packages/jira-source
git commit -m "feat(jira-source): adfToText converter"
```

---

### Task 4: JiraClient

**Files:**
- Create: `packages/jira-source/src/client.ts`
- Test: `packages/jira-source/test/client.test.ts`

**Interfaces:**
- Produces: `JiraClient` per spec section 5.

- [ ] **Step 1: Failing test (with fetch mock)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { JiraClient } from '../src/client';

global.fetch = vi.fn();

it('sets Basic auth header', async () => {
  (fetch as any).mockResolvedValue(new Response(
    JSON.stringify({ accountId: 'u1', emailAddress: 'me@x.com' }),
    { status: 200, headers: { 'content-type':'application/json' }}));
  const client = new JiraClient({ baseUrl:'https://acme.atlassian.net', email:'me@x.com', token:'tok' });
  await client.myself();
  const call = (fetch as any).mock.calls[0];
  expect(call[1].headers.authorization).toBe(
    'Basic ' + Buffer.from('me@x.com:tok').toString('base64'));
});

it('retries on 429 with backoff', async () => {
  let calls = 0;
  (fetch as any).mockImplementation(async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' }});
    return new Response(JSON.stringify({ issues: [], total: 0, isLast: true }), { status: 200 });
  });
  const client = new JiraClient({ baseUrl:'https://x.atlassian.net', email:'a', token:'b' });
  const r = await client.search('project=WS');
  expect(calls).toBe(2);
  expect(r.total).toBe(0);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// packages/jira-source/src/client.ts
export interface JiraIssue {
  id: string; key: string;
  fields: { summary: string; updated: string; assignee?: { accountId: string } | null };
}
export interface JiraComment {
  id: string; created: string; updated: string;
  author: { accountId: string; displayName: string; emailAddress?: string };
  body: any; // ADF
}

export class JiraClient {
  private authHeader: string;
  constructor(private opts: { baseUrl: string; email: string; token: string }) {
    this.authHeader = 'Basic ' + Buffer.from(`${opts.email}:${opts.token}`).toString('base64');
  }

  private async req<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
      ...init,
      headers: { ...(init?.headers || {}), authorization: this.authHeader, accept: 'application/json' },
    });
    if (res.status === 429 && attempt < 3) {
      const ra = parseInt(res.headers.get('retry-after') ?? '1', 10);
      await new Promise(r => setTimeout(r, Math.max(ra * 1000, 250 * 2 ** attempt)));
      return this.req<T>(path, init, attempt + 1);
    }
    if (!res.ok) throw new Error(`JIRA ${path} -> ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  myself() { return this.req<{ accountId: string; emailAddress: string }>('/rest/api/3/myself'); }

  search(jql: string, opts: { fields?: string[]; startAt?: number; maxResults?: number } = {}) {
    const params = new URLSearchParams({
      jql,
      startAt: String(opts.startAt ?? 0),
      maxResults: String(opts.maxResults ?? 50),
      fields: (opts.fields ?? ['summary','updated','assignee']).join(','),
    });
    return this.req<{ issues: JiraIssue[]; total: number; isLast: boolean }>(
      `/rest/api/3/search?${params}`);
  }

  async listComments(issueKey: string) {
    const r = await this.req<{ comments: JiraComment[] }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=-created`);
    return r.comments;
  }

  listProjects() {
    return this.req<{ values: { key: string; name: string }[] }>('/rest/api/3/project/search?maxResults=100');
  }

  listFields() {
    return this.req<{ id: string; name: string; custom: boolean }[]>('/rest/api/3/field');
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add packages/jira-source
git commit -m "feat(jira-source): JiraClient with Basic auth + 429 retry"
```

---

### Task 5: JiraSource (implements Source)

**Files:**
- Create: `packages/jira-source/src/jira-source.ts`
- Test: `packages/jira-source/test/jira-source.test.ts`

**Interfaces:**
- Consumes: `Source` from `@work-summary/core`, `JiraSiteRow`/`JiraProjectRow` from storage.
- Produces:
```ts
export interface JiraSourceDeps {
  sites: JiraSiteRow[];
  projects: JiraProjectRow[];
  decryptToken: (encrypted: string) => string;
}
export class JiraSource implements Source {
  readonly name = 'jira';
  constructor(deps: JiraSourceDeps);
  fetchPendingComments(opts: { since: Date }): Promise<NotifiedCommentInput[]>;
}
```

- [ ] **Step 1: Failing test**

```ts
it('filters out comments authored by current user', async () => {
  // mock fetch with sequence: /myself, /search, /comment
  const calls: string[] = [];
  global.fetch = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/myself')) return new Response(JSON.stringify({ accountId: 'me' }));
    if (url.includes('/search')) return new Response(JSON.stringify({
      issues: [{ id:'1', key:'WS-1', fields:{ summary:'x', updated:new Date().toISOString() }}],
      total: 1, isLast: true,
    }));
    if (url.includes('/comment')) return new Response(JSON.stringify({ comments: [
      { id:'c1', created:new Date().toISOString(), updated:new Date().toISOString(),
        author:{ accountId:'me', displayName:'Me' },
        body:{ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text:'self' }]}]}},
      { id:'c2', created:new Date().toISOString(), updated:new Date().toISOString(),
        author:{ accountId:'other', displayName:'Other' },
        body:{ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text:'asking u' }]}]}},
    ]}));
    return new Response('', { status: 404 });
  });

  const source = new JiraSource({
    sites: [{ id:'s', baseUrl:'https://x.atlassian.net', email:'me@x', encryptedToken:'enc',
              developerFieldId:null, enabled:true, createdAt:'', updatedAt:'' }],
    projects: [{ id:1, siteId:'s', projectKey:'WS', projectName:'Work' }],
    decryptToken: () => 'tok',
  });
  const out = await source.fetchPendingComments({ since: new Date(Date.now() - 7*86400000) });
  expect(out).toHaveLength(1);
  expect(out[0].author).toBe('Other');
  expect(out[0].source).toBe('jira');
  expect(out[0].issueKey).toBe('WS-1');
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// packages/jira-source/src/jira-source.ts
import { createHash } from 'crypto';
import type { Source, NotifiedCommentInput } from '@work-summary/core';
import type { JiraSiteRow, JiraProjectRow } from '@work-summary/storage';
import { JiraClient } from './client';
import { adfToText } from './adf';

export interface JiraSourceDeps {
  sites: JiraSiteRow[];
  projects: JiraProjectRow[];
  decryptToken: (encrypted: string) => string;
}

export class JiraSource implements Source {
  readonly name = 'jira';
  constructor(private deps: JiraSourceDeps) {}

  async fetchPendingComments(opts: { since: Date }): Promise<NotifiedCommentInput[]> {
    const out: NotifiedCommentInput[] = [];
    for (const site of this.deps.sites.filter(s => s.enabled)) {
      const client = new JiraClient({
        baseUrl: site.baseUrl, email: site.email,
        token: this.deps.decryptToken(site.encryptedToken),
      });
      const me = await client.myself();
      const projects = this.deps.projects.filter(p => p.siteId === site.id);
      for (const p of projects) {
        const devClause = site.developerFieldId
          ? ` OR "${site.developerFieldId}" = currentUser()` : '';
        const jql = `project = "${p.projectKey}" AND (assignee = currentUser() OR reporter = currentUser()${devClause}) AND updated >= -7d ORDER BY updated DESC`;
        const result = await client.search(jql);
        for (const issue of result.issues) {
          const comments = await client.listComments(issue.key);
          await new Promise(r => setTimeout(r, 100));
          for (const c of comments) {
            if (c.author.accountId === me.accountId) continue;
            if (new Date(c.created) < opts.since) continue;
            const url = `${site.baseUrl}/browse/${issue.key}?focusedCommentId=${c.id}`;
            const fingerprint = createHash('sha256')
              .update(`jira|${url}|${c.author.accountId}|${c.body && JSON.stringify(c.body)}`)
              .digest('hex');
            out.push({
              id: fingerprint,
              source: 'jira',
              repoOrProject: `${site.baseUrl} :: ${p.projectKey}`,
              issueKey: issue.key,
              prOrIssueUrl: url,
              commentUrl: url,
              author: c.author.displayName,
              body: adfToText(c.body).slice(0, 2000),
              createdAt: c.created,
              updatedAt: c.updated,
            });
          }
        }
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Update `NotifiedCommentInput` in `@work-summary/storage` to include `issueKey?: string | null`. Update insert SQL to write it.**

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add packages/jira-source packages/storage
git commit -m "feat(jira-source): JiraSource implementing Source interface + issueKey"
```

---

### Task 6: API routes /api/jira

**Files:**
- Create: `apps/api/src/routes/jira.ts`
- Modify: `apps/api/src/server.ts` (mount routes, wire repositories)
- Test: `apps/api/test/routes/jira.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('POST /sites validates connection before saving', async () => {
  // mock JIRA /myself returning 401
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response('', { status: 401 })));
  const { app } = await buildTestApp();
  const res = await app.inject({ method:'POST', url:'/api/jira/sites',
    headers:{ cookie: await loginCookie(app) },
    payload:{ baseUrl:'https://x.atlassian.net', email:'a@b', token:'bad' }});
  expect(res.statusCode).toBe(400);
  expect(res.json().error).toMatch(/connection failed/i);
});

it('redacts encrypted_token in GET response', async () => {
  // ... set up site
  const res = await app.inject({ method:'GET', url:'/api/jira/sites',
    headers:{ cookie: await loginCookie(app) }});
  expect(res.json()[0]).not.toHaveProperty('encryptedToken');
  expect(res.json()[0]).not.toHaveProperty('token');
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// apps/api/src/routes/jira.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { JiraClient } from '@work-summary/jira-source';

const SiteBody = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  token: z.string().min(8),
  developerFieldId: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
});

const ProjectSelection = z.object({
  projects: z.array(z.object({ projectKey: z.string(), projectName: z.string() })),
});

function redact(row: any) {
  const { encryptedToken, ...rest } = row;
  return rest;
}

export const jiraRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  const siteRepo = app.jiraSiteRepo;
  const projectRepo = app.jiraProjectRepo;
  const enc = app.encryption;

  app.get('/sites', async () => siteRepo.list().map(redact));

  app.post('/sites', async (req, reply) => {
    const body = SiteBody.parse(req.body);
    try {
      const client = new JiraClient({ baseUrl: body.baseUrl, email: body.email, token: body.token });
      await client.myself();
    } catch (err: any) {
      reply.code(400);
      return { error: `connection failed: ${err.message}` };
    }
    const row = siteRepo.insert({
      id: randomUUID(),
      baseUrl: body.baseUrl,
      email: body.email,
      encryptedToken: enc.encrypt(body.token),
      developerFieldId: body.developerFieldId ?? null,
      enabled: body.enabled,
    });
    reply.code(201);
    return redact(row);
  });

  app.put('/sites/:id', async (req) => {
    const id = (req.params as any).id;
    const body = SiteBody.partial().parse(req.body);
    const patch: any = { ...body };
    if (body.token) patch.encryptedToken = enc.encrypt(body.token);
    delete patch.token;
    return redact(siteRepo.update(id, patch));
  });

  app.delete('/sites/:id', async (req, reply) => {
    siteRepo.delete((req.params as any).id);
    reply.code(204);
  });

  app.get('/sites/:id/projects', async (req) => {
    return projectRepo.listBySite((req.params as any).id);
  });

  app.put('/sites/:id/projects', async (req) => {
    const id = (req.params as any).id;
    const body = ProjectSelection.parse(req.body);
    return projectRepo.replaceForSite(id, body.projects);
  });

  app.get('/sites/:id/projects/discover', async (req) => {
    const site = siteRepo.get((req.params as any).id);
    if (!site) throw app.httpErrors.notFound();
    const client = new JiraClient({
      baseUrl: site.baseUrl, email: site.email, token: enc.decrypt(site.encryptedToken),
    });
    const r = await client.listProjects();
    return r.values;
  });

  app.get('/sites/:id/fields/discover', async (req) => {
    const site = siteRepo.get((req.params as any).id);
    if (!site) throw app.httpErrors.notFound();
    const client = new JiraClient({
      baseUrl: site.baseUrl, email: site.email, token: enc.decrypt(site.encryptedToken),
    });
    const fields = await client.listFields();
    return fields.filter(f => f.custom && /develop/i.test(f.name));
  });
};
```

- [ ] **Step 4: Mount in server.ts**

```ts
import { JiraSiteRepository, JiraProjectRepository } from '@work-summary/storage';
import { jiraRoutes } from './routes/jira';

const jiraSiteRepo = new JiraSiteRepository(db);
const jiraProjectRepo = new JiraProjectRepository(db);
app.decorate('jiraSiteRepo', jiraSiteRepo);
app.decorate('jiraProjectRepo', jiraProjectRepo);
app.register(jiraRoutes, { prefix: '/api/jira' });
```

- [ ] **Step 5: Wire JIRA into scan-runner** - extend the source list:

```ts
// in scan-runner.ts
const sources: Source[] = [
  new GithubSource(/* ... */),
  new JiraSource({
    sites: jiraSiteRepo.list(),
    projects: jiraProjectRepo.listBySite, // adapt
    decryptToken: (e) => encryption.decrypt(e),
  }),
];
```

- [ ] **Step 6: Tests pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): /api/jira sites + projects + field discovery + scan integration"
```

---

### Task 7: Web - Sources screen "JIRA" tab

**Files:**
- Create: `apps/web/src/pages/sources/JiraTab.tsx`, `apps/web/src/components/JiraSiteDialog.tsx`
- Modify: `apps/web/src/pages/Sources.tsx` (add tabs)
- Test: `apps/web/test/sources/JiraTab.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('adds JIRA site, then discovers and selects projects', async () => {
  const user = userEvent.setup();
  renderWithProviders(<JiraTab />);
  await user.click(screen.getByRole('button', { name: /add jira site/i }));
  await user.type(screen.getByLabelText(/base url/i), 'https://acme.atlassian.net');
  await user.type(screen.getByLabelText(/email/i), 'me@x.com');
  await user.type(screen.getByLabelText(/api token/i), 'tok123');
  await user.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => screen.getByText('acme.atlassian.net'));
  await user.click(screen.getByRole('button', { name: /discover projects/i }));
  await waitFor(() => screen.getByText('Work Summary (WS)'));
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```tsx
// apps/web/src/pages/sources/JiraTab.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { JiraSiteDialog } from '@/components/JiraSiteDialog';
import { Button } from '@/components/ui/button';

export function JiraTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const sites = useQuery({ queryKey:['jira-sites'],
    queryFn: () => fetch('/api/jira/sites').then(r=>r.json()) });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>+ Add JIRA site</Button>
      </div>
      <div className="grid gap-3">
        {(sites.data ?? []).map((s: any) => (
          <SiteCard key={s.id} site={s} onChanged={() => qc.invalidateQueries({ queryKey:['jira-sites'] })} />
        ))}
      </div>
      <JiraSiteDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function SiteCard({ site, onChanged }: any) {
  const projects = useQuery({
    queryKey: ['jira-projects', site.id],
    queryFn: () => fetch(`/api/jira/sites/${site.id}/projects`).then(r => r.json()),
  });
  const discover = useMutation({
    mutationFn: () => fetch(`/api/jira/sites/${site.id}/projects/discover`).then(r => r.json()),
  });
  return (
    <div className="border rounded p-4">
      <div className="flex justify-between">
        <div>
          <div className="font-medium">{new URL(site.baseUrl).hostname}</div>
          <div className="text-sm text-muted-foreground">{site.email}</div>
        </div>
        <Button variant="outline" onClick={() => discover.mutate()}>Discover projects</Button>
      </div>
      <div className="mt-3">
        {(projects.data ?? []).map((p: any) => (
          <span key={p.projectKey} className="inline-block mr-2 mb-1 text-xs border rounded px-2 py-1">
            {p.projectName} ({p.projectKey})
          </span>
        ))}
        {discover.data && (
          <ProjectPicker siteId={site.id} discovered={discover.data} onSaved={onChanged} />
        )}
      </div>
    </div>
  );
}

function ProjectPicker({ siteId, discovered, onSaved }: any) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const save = useMutation({
    mutationFn: () => fetch(`/api/jira/sites/${siteId}/projects`, {
      method:'PUT', headers:{ 'content-type':'application/json' },
      body: JSON.stringify({
        projects: discovered.filter((p:any)=>selected.has(p.key))
          .map((p:any)=>({ projectKey:p.key, projectName:p.name })),
      }),
    }),
    onSuccess: onSaved,
  });
  return (
    <div className="mt-3 border-t pt-3">
      <div className="text-sm font-medium mb-2">Select projects to scan</div>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {discovered.map((p: any) => (
          <label key={p.key} className="flex items-center gap-2">
            <input type="checkbox"
              onChange={(e) => {
                const s = new Set(selected);
                e.target.checked ? s.add(p.key) : s.delete(p.key);
                setSelected(s);
              }} />
            {p.name} ({p.key})
          </label>
        ))}
      </div>
      <Button className="mt-2" size="sm" onClick={() => save.mutate()}>Save selection</Button>
    </div>
  );
}
```

- [ ] **Step 4: Dialog component (analogous to ScheduleDialog from Phase 3, fields per spec section 10)**

- [ ] **Step 5: Update Sources.tsx to use shadcn Tabs:**

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { GithubTab } from './sources/GithubTab';
import { JiraTab } from './sources/JiraTab';

<Tabs defaultValue="github">
  <TabsList>
    <TabsTrigger value="github">GitHub</TabsTrigger>
    <TabsTrigger value="jira">JIRA</TabsTrigger>
  </TabsList>
  <TabsContent value="github"><GithubTab /></TabsContent>
  <TabsContent value="jira"><JiraTab /></TabsContent>
</Tabs>
```

- [ ] **Step 6: Add JIRA badge to dashboard comment cards**

```tsx
// in CommentCard
<Badge variant={comment.source === 'jira' ? 'secondary' : 'default'}>
  {comment.source === 'jira' ? `JIRA: ${comment.issueKey}` : 'GitHub'}
</Badge>
```

- [ ] **Step 7: Tests pass**

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): JIRA tab in Sources with site CRUD + project discovery"
```

---

### Task 8: E2E

**Files:** `apps/web/e2e/jira.spec.ts`

- [ ] **Step 1: Test** (with API mocked at network layer using Playwright's `page.route`)

```ts
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test('add JIRA site flow', async ({ page }) => {
  await page.route('**/api/jira/sites', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ status: 201, body: JSON.stringify({
        id:'s1', baseUrl:'https://acme.atlassian.net', email:'me@x.com', enabled:true })});
    return route.fulfill({ json: [] });
  });
  await loginAs(page);
  await page.goto('/sources');
  await page.getByRole('tab', { name: 'JIRA' }).click();
  await page.getByRole('button', { name: /add jira site/i }).click();
  await page.getByLabel(/base url/i).fill('https://acme.atlassian.net');
  await page.getByLabel(/email/i).fill('me@x.com');
  await page.getByLabel(/api token/i).fill('tok123');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText('acme.atlassian.net')).toBeVisible();
});
```

- [ ] **Step 2: Pass; commit**

```bash
git add apps/web/e2e
git commit -m "test(web): E2E JIRA site add flow"
```

---

## Self-Review Notes

- Comment dedup: fingerprint uses `JSON.stringify(c.body)` which is non-deterministic across JIRA edits; if the user edits a comment, a new fingerprint is generated. Acceptable for v1 - the digest will show both versions but the addressed-status carries the original id, so the new one re-surfaces. Documented as known limitation.
- `decryptToken` in `JiraSource` is passed in by caller so the source package doesn't depend on the auth package directly.
- The `NotifiedCommentInput.issueKey` is the only Phase 4 change to shared types; backward compatible (nullable).
- `app.encryption` and `app.requireAuth` decorators were defined in Phase 2 - reused here.
