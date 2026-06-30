# Phase 6 - Reply to Comments from Dashboard - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users reply to GitHub and JIRA comments directly from the dashboard, persisting reply history locally.

**Architecture:** New reply adapter modules in github-source and jira-source. Migration 0006 adds comment_reply table and can_write flags. New API endpoints POST/GET replies. Dashboard card gains inline composer.

**Tech Stack:** octokit (existing), JiraClient (existing), react-hook-form, shadcn/ui Textarea.

## Global Constraints
- A reply that fails MUST NOT change comment status.
- Successful reply marks comment status `addressed` (Phase 2 status states).
- Error responses must use stable codes for UI to switch on.
- `comment_reply.body` stores plain text (the user's input), regardless of source-specific encoding.
- Reply text limit: 10000 chars (enforced server-side via zod).

---

### Task 1: Migration 0006

**Files:**
- Create: `packages/storage/src/migrations/0006_comment_reply.sql`
- Modify: `packages/storage/src/db.ts`
- Test: `packages/storage/test/migration-0006.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('creates comment_reply with FK cascade and can_write flags', () => {
  const db = initDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all().map((r:any)=>r.name);
  expect(tables).toContain('comment_reply');
  const sc = db.prepare("PRAGMA table_info(source_config)").all() as any[];
  expect(sc.find(c=>c.name==='can_write')).toBeTruthy();
  const js = db.prepare("PRAGMA table_info(jira_site)").all() as any[];
  expect(js.find(c=>c.name==='can_write')).toBeTruthy();
});
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: SQL** (spec section 4)

- [ ] **Step 4: Tests pass; commit**

```bash
git add packages/storage
git commit -m "feat(storage): migration 0006 (comment_reply + can_write flags)"
```

---

### Task 2: CommentReplyRepository

**Files:**
- Create: `packages/storage/src/comment-reply-repository.ts`
- Test: `packages/storage/test/comment-reply-repository.test.ts`

**Interfaces:**
- Produces:
```ts
export interface CommentReplyRow {
  id: number; commentId: string; body: string;
  sentAt: string; source: string;
  sourceResponseId: string | null; sourceUrl: string | null;
}
export class CommentReplyRepository {
  constructor(db: Database.Database);
  insert(row: Omit<CommentReplyRow,'id'>): CommentReplyRow;
  listByComment(commentId: string): CommentReplyRow[];
}
```

- [ ] **Step 1: Failing test**

```ts
it('inserts and lists ordered by sent_at', () => {
  const repo = new CommentReplyRepository(db);
  repo.insert({ commentId:'c1', body:'first', sentAt:'2025-01-01T00:00:00Z',
    source:'github', sourceResponseId:'1', sourceUrl:'https://x/1' });
  repo.insert({ commentId:'c1', body:'second', sentAt:'2025-01-02T00:00:00Z',
    source:'github', sourceResponseId:'2', sourceUrl:'https://x/2' });
  const rows = repo.listByComment('c1');
  expect(rows.map(r=>r.body)).toEqual(['first','second']);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
import type Database from 'better-sqlite3';

export class CommentReplyRepository {
  constructor(private db: Database.Database) {}

  insert(row: Omit<CommentReplyRow,'id'>): CommentReplyRow {
    const r = this.db.prepare(`INSERT INTO comment_reply
      (comment_id, body, sent_at, source, source_response_id, source_url)
      VALUES (?,?,?,?,?,?)`).run(
      row.commentId, row.body, row.sentAt, row.source,
      row.sourceResponseId, row.sourceUrl);
    return { id: Number(r.lastInsertRowid), ...row };
  }

  listByComment(commentId: string): CommentReplyRow[] {
    return this.db.prepare(
      'SELECT * FROM comment_reply WHERE comment_id=? ORDER BY sent_at ASC'
    ).all(commentId).map((r:any) => ({
      id: r.id, commentId: r.comment_id, body: r.body,
      sentAt: r.sent_at, source: r.source,
      sourceResponseId: r.source_response_id, sourceUrl: r.source_url,
    }));
  }
}
```

- [ ] **Step 4: Tests pass; commit**

```bash
git add packages/storage
git commit -m "feat(storage): CommentReplyRepository"
```

---

### Task 3: GitHub URL parser + reply adapter

**Files:**
- Create: `packages/github-source/src/reply-url.ts`, `packages/github-source/src/reply.ts`
- Test: `packages/github-source/test/reply-url.test.ts`, `packages/github-source/test/reply.test.ts`

**Interfaces:**
- Produces:
```ts
export type GithubCommentLocation =
  | { kind: 'pr-review-reply'; owner: string; repo: string; pullNumber: number; commentId: number }
  | { kind: 'issue-comment';   owner: string; repo: string; issueNumber: number };

export function parseGithubCommentUrl(url: string): GithubCommentLocation;
export async function postGithubReply(ctx: GithubReplyContext): Promise<GithubReplyResult>;
```

- [ ] **Step 1: Failing test for URL parser**

```ts
import { parseGithubCommentUrl } from '../src/reply-url';

it('parses PR review comment URL', () => {
  expect(parseGithubCommentUrl(
    'https://github.com/me/repo/pull/42#discussion_r12345'
  )).toEqual({ kind:'pr-review-reply', owner:'me', repo:'repo',
    pullNumber:42, commentId:12345 });
});

it('parses PR issue comment URL', () => {
  expect(parseGithubCommentUrl(
    'https://github.com/me/repo/pull/42#issuecomment-99'
  )).toEqual({ kind:'issue-comment', owner:'me', repo:'repo', issueNumber:42 });
});

it('parses issue comment URL', () => {
  expect(parseGithubCommentUrl(
    'https://github.com/me/repo/issues/7#issuecomment-100'
  )).toEqual({ kind:'issue-comment', owner:'me', repo:'repo', issueNumber:7 });
});

it('throws on unknown URL', () => {
  expect(() => parseGithubCommentUrl('https://example.com/x')).toThrow(/unknown/i);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Parser implementation**

```ts
// packages/github-source/src/reply-url.ts
const PR_REVIEW = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#discussion_r(\d+)$/;
const PR_ISSUE  = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#issuecomment-\d+$/;
const ISSUE     = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)#issuecomment-\d+$/;

export function parseGithubCommentUrl(url: string): GithubCommentLocation {
  let m = url.match(PR_REVIEW);
  if (m) return { kind:'pr-review-reply', owner:m[1], repo:m[2],
    pullNumber: Number(m[3]), commentId: Number(m[4]) };
  m = url.match(PR_ISSUE);
  if (m) return { kind:'issue-comment', owner:m[1], repo:m[2], issueNumber: Number(m[3]) };
  m = url.match(ISSUE);
  if (m) return { kind:'issue-comment', owner:m[1], repo:m[2], issueNumber: Number(m[3]) };
  throw new Error(`unknown GitHub comment URL: ${url}`);
}
```

- [ ] **Step 4: Failing test for adapter (octokit mocked)**

```ts
import { postGithubReply } from '../src/reply';

const mkOctokit = (impl: any) => ({
  request: vi.fn().mockImplementation(impl),
});

it('replies to PR review comment via /replies endpoint', async () => {
  const octokit = mkOctokit(async (route: string, params: any) => {
    expect(route).toBe('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies');
    expect(params).toMatchObject({ owner:'me', repo:'repo', pull_number:42, comment_id:12345, body:'thanks!' });
    return { data: { id: 999, html_url: 'https://x/999' }};
  });
  const r = await postGithubReply({ octokit: octokit as any,
    commentUrl:'https://github.com/me/repo/pull/42#discussion_r12345',
    body:'thanks!' });
  expect(r).toEqual({ id: 999, url: 'https://x/999' });
});

it('replies to issue comment via /comments endpoint', async () => {
  const octokit = mkOctokit(async (route: string, params: any) => {
    expect(route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
    expect(params).toMatchObject({ owner:'me', repo:'repo', issue_number:7, body:'ack' });
    return { data: { id: 100, html_url: 'https://x/100' }};
  });
  const r = await postGithubReply({ octokit: octokit as any,
    commentUrl:'https://github.com/me/repo/issues/7#issuecomment-50',
    body:'ack' });
  expect(r.id).toBe(100);
});

it('maps 401/403 to a specific error', async () => {
  const octokit = mkOctokit(async () => {
    const err: any = new Error('forbidden');
    err.status = 403;
    throw err;
  });
  await expect(postGithubReply({ octokit: octokit as any,
    commentUrl:'https://github.com/me/repo/issues/1#issuecomment-1', body:'x' }))
    .rejects.toMatchObject({ code: 'token-write-scope' });
});
```

- [ ] **Step 5: Adapter implementation**

```ts
// packages/github-source/src/reply.ts
import type { Octokit } from 'octokit';
import { parseGithubCommentUrl } from './reply-url';

export interface GithubReplyContext { octokit: Octokit; commentUrl: string; body: string; }
export interface GithubReplyResult { id: number; url: string; }

export async function postGithubReply(ctx: GithubReplyContext): Promise<GithubReplyResult> {
  const loc = parseGithubCommentUrl(ctx.commentUrl);
  try {
    if (loc.kind === 'pr-review-reply') {
      const res = await ctx.octokit.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
        { owner: loc.owner, repo: loc.repo, pull_number: loc.pullNumber,
          comment_id: loc.commentId, body: ctx.body });
      return { id: res.data.id, url: res.data.html_url };
    } else {
      const res = await ctx.octokit.request(
        'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
        { owner: loc.owner, repo: loc.repo, issue_number: loc.issueNumber, body: ctx.body });
      return { id: res.data.id, url: res.data.html_url };
    }
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      const e: any = new Error('GitHub token lacks write scope');
      e.code = 'token-write-scope';
      e.status = err.status;
      throw e;
    }
    throw err;
  }
}
```

- [ ] **Step 6: Tests pass; commit**

```bash
git add packages/github-source
git commit -m "feat(github-source): reply adapter with URL discriminator + scope mapping"
```

---

### Task 4: JIRA reply adapter

**Files:**
- Create: `packages/jira-source/src/text-to-adf.ts`, `packages/jira-source/src/reply.ts`
- Test: `packages/jira-source/test/text-to-adf.test.ts`, `packages/jira-source/test/reply.test.ts`

**Interfaces:**
- Produces:
```ts
export function textToAdf(text: string): AdfDoc;
export async function postJiraReply(ctx: JiraReplyContext): Promise<JiraReplyResult>;
```

- [ ] **Step 1: Failing test for textToAdf**

```ts
it('wraps lines in paragraphs', () => {
  expect(textToAdf('hello\nworld')).toEqual({
    type: 'doc', version: 1,
    content: [
      { type:'paragraph', content:[{ type:'text', text:'hello' }]},
      { type:'paragraph', content:[{ type:'text', text:'world' }]},
    ],
  });
});

it('drops empty lines', () => {
  expect(textToAdf('a\n\nb').content).toHaveLength(2);
});
```

- [ ] **Step 2: textToAdf implementation**

```ts
export function textToAdf(text: string) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: lines.length === 0
      ? [{ type: 'paragraph', content: [] }]
      : lines.map(line => ({ type:'paragraph', content:[{ type:'text', text: line }]})),
  };
}
```

- [ ] **Step 3: Failing test for reply adapter**

```ts
import { postJiraReply } from '../src/reply';
import { JiraClient } from '../src/client';

it('POSTs ADF comment to issue endpoint', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: '10001', self: 'https://x.atlassian.net/rest/api/3/issue/WS-1/comment/10001',
  }), { status: 201 }));
  const client = new JiraClient({ baseUrl:'https://x.atlassian.net', email:'me@x', token:'tok' });
  const r = await postJiraReply({ client, issueKey:'WS-1', body:'noted' });
  expect((fetch as any).mock.calls[0][0]).toContain('/rest/api/3/issue/WS-1/comment');
  const reqBody = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(reqBody.body.type).toBe('doc');
  expect(reqBody.body.content[0].content[0].text).toBe('noted');
  expect(r.id).toBe('10001');
});

it('maps 401 to token-write-scope', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
  const client = new JiraClient({ baseUrl:'https://x', email:'a', token:'b' });
  await expect(postJiraReply({ client, issueKey:'WS-1', body:'x' }))
    .rejects.toMatchObject({ code: 'token-write-scope' });
});
```

- [ ] **Step 4: Adapter implementation**

```ts
// packages/jira-source/src/reply.ts
import type { JiraClient } from './client';
import { textToAdf } from './text-to-adf';

export interface JiraReplyContext { client: JiraClient; issueKey: string; body: string; }
export interface JiraReplyResult { id: string; self: string; }

export async function postJiraReply(ctx: JiraReplyContext): Promise<JiraReplyResult> {
  try {
    // Use a small public method on JiraClient. We add it next:
    return await ctx.client.addComment(ctx.issueKey, textToAdf(ctx.body));
  } catch (err: any) {
    if (err.status === 401 || err.status === 403 || /401|403/.test(String(err.message))) {
      const e: any = new Error('JIRA token lacks write permissions');
      e.code = 'token-write-scope';
      e.status = err.status ?? 401;
      throw e;
    }
    throw err;
  }
}
```

- [ ] **Step 5: Extend JiraClient with addComment**

```ts
// packages/jira-source/src/client.ts (add method)
async addComment(issueKey: string, adfBody: any): Promise<{ id: string; self: string }> {
  const res = await fetch(`${this.opts.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    headers: { authorization: this.authHeader, 'content-type':'application/json', accept:'application/json' },
    body: JSON.stringify({ body: adfBody }),
  });
  if (!res.ok) {
    const err: any = new Error(`JIRA addComment ${issueKey} -> ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json() as any;
  return { id: data.id, self: data.self };
}
```

- [ ] **Step 6: Tests pass; commit**

```bash
git add packages/jira-source
git commit -m "feat(jira-source): reply adapter (textToAdf + addComment + scope mapping)"
```

---

### Task 5: API route POST /api/comments/:id/reply

**Files:**
- Create: `apps/api/src/routes/replies.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/test/routes/replies.test.ts`

**Interfaces:**
- Consumes: `CommentReplyRepository`, `CommentStatusRepository` (Phase 2), reply adapters.
- Produces: REST endpoints per spec section 7.

- [ ] **Step 1: Failing test**

```ts
it('POST github reply succeeds and marks comment addressed', async () => {
  const { app, db } = await buildTestApp();
  // seed a comment with github source
  insertTestComment(db, { id:'c1', source:'github',
    commentUrl:'https://github.com/me/repo/issues/1#issuecomment-1' });

  vi.mocked(octokitRequest).mockResolvedValue({ data: { id: 999, html_url:'https://x/999' }});

  const res = await app.inject({ method:'POST', url:'/api/comments/c1/reply',
    headers:{ cookie: await loginCookie(app) },
    payload:{ body: 'thanks' }});

  expect(res.statusCode).toBe(200);
  expect(res.json().reply.body).toBe('thanks');
  const status = db.prepare('SELECT status FROM comment_status WHERE comment_id=?').get('c1') as any;
  expect(status.status).toBe('addressed');
});

it('upstream 403 returns 400 token-write-scope, status unchanged', async () => {
  const { app, db } = await buildTestApp();
  insertTestComment(db, { id:'c2', source:'github',
    commentUrl:'https://github.com/me/repo/issues/2#issuecomment-2' });
  vi.mocked(octokitRequest).mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

  const res = await app.inject({ method:'POST', url:'/api/comments/c2/reply',
    headers:{ cookie: await loginCookie(app) },
    payload:{ body: 'x' }});

  expect(res.statusCode).toBe(400);
  expect(res.json().error).toBe('token-write-scope');
  const status = db.prepare('SELECT status FROM comment_status WHERE comment_id=?').get('c2') as any;
  expect(status?.status ?? 'pending').toBe('pending');
});

it('GET /:id/replies returns list', async () => {
  // seed two replies, expect array of two
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// apps/api/src/routes/replies.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Octokit } from 'octokit';
import { postGithubReply } from '@work-summary/github-source';
import { postJiraReply, JiraClient } from '@work-summary/jira-source';

const Body = z.object({ body: z.string().min(1).max(10000) });

export const repliesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  const commentRepo = app.notifiedCommentRepo;
  const replyRepo = app.commentReplyRepo;
  const statusRepo = app.commentStatusRepo;
  const sourceRepo = app.sourceConfigRepo;
  const jiraSiteRepo = app.jiraSiteRepo;
  const enc = app.encryption;

  app.post('/:id/reply', async (req, reply) => {
    const id = (req.params as any).id;
    const { body } = Body.parse(req.body);
    const comment = commentRepo.get(id);
    if (!comment) throw app.httpErrors.notFound();

    try {
      let result: { id: string | number; url: string };
      if (comment.source === 'github') {
        const cfg = sourceRepo.getGithubFor(comment.repoOrProject);
        if (!cfg) throw app.httpErrors.preconditionFailed('No GitHub source configured');
        const token = enc.decrypt(cfg.encryptedToken);
        const r = await postGithubReply({
          octokit: new Octokit({ auth: token }),
          commentUrl: comment.commentUrl,
          body,
        });
        result = { id: r.id, url: r.url };
      } else if (comment.source === 'jira') {
        const site = jiraSiteRepo.getForRepoOrProject(comment.repoOrProject);
        if (!site) throw app.httpErrors.preconditionFailed('No JIRA site configured');
        const client = new JiraClient({
          baseUrl: site.baseUrl, email: site.email,
          token: enc.decrypt(site.encryptedToken),
        });
        const r = await postJiraReply({ client, issueKey: comment.issueKey!, body });
        result = { id: r.id, url: r.self };
      } else {
        throw app.httpErrors.badRequest(`unsupported source: ${comment.source}`);
      }

      const row = replyRepo.insert({
        commentId: id,
        body,
        sentAt: new Date().toISOString(),
        source: comment.source,
        sourceResponseId: String(result.id),
        sourceUrl: result.url,
      });
      statusRepo.set(id, 'addressed', app.currentUserId(req));
      return { reply: row, status: 'addressed' };
    } catch (err: any) {
      if (err.code === 'token-write-scope') {
        reply.code(400);
        return { error: 'token-write-scope', message: err.message };
      }
      reply.code(502);
      return { error: 'upstream', message: err.message };
    }
  });

  app.get('/:id/replies', async (req) => {
    return replyRepo.listByComment((req.params as any).id);
  });
};
```

- [ ] **Step 4: Mount in server.ts**

```ts
import { CommentReplyRepository } from '@work-summary/storage';
import { repliesRoutes } from './routes/replies';

const commentReplyRepo = new CommentReplyRepository(db);
app.decorate('commentReplyRepo', commentReplyRepo);
app.register(repliesRoutes, { prefix: '/api/comments' });
```

- [ ] **Step 5: Add `sourceConfigRepo.getGithubFor(repo)` and `jiraSiteRepo.getForRepoOrProject(s)` helpers**

```ts
// packages/storage/src/source-config-repository.ts (add)
getGithubFor(repoFullName: string): SourceConfigRow | null {
  // simple match: source='github' AND any of source_config.repos array contains repoFullName
  const all = this.list().filter(r => r.kind === 'github');
  return all.find(r => (r.repos ?? []).includes(repoFullName)) ?? null;
}

// packages/storage/src/jira-site-repository.ts (add)
getForRepoOrProject(repoOrProject: string): JiraSiteRow | null {
  // notified_comments stores repoOrProject as `${baseUrl} :: ${projectKey}`
  const [baseUrl] = repoOrProject.split(' :: ');
  const all = this.list();
  return all.find(s => s.baseUrl === baseUrl) ?? null;
}
```

- [ ] **Step 6: Tests pass; commit**

```bash
git add apps/api packages/storage
git commit -m "feat(api): POST /api/comments/:id/reply + GET /:id/replies"
```

---

### Task 6: Web - inline reply composer on comment card

**Files:**
- Modify: `apps/web/src/components/CommentCard.tsx`
- Create: `apps/web/src/components/ReplyComposer.tsx`
- Test: `apps/web/test/CommentCard.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('reply success flips status to addressed and shows reply pill', async () => {
  server.use(
    http.post('/api/comments/c1/reply', () => HttpResponse.json({
      reply: { id:1, commentId:'c1', body:'thanks', sentAt: new Date().toISOString(),
        source:'github', sourceResponseId:'1', sourceUrl:'https://x/1' },
      status: 'addressed',
    })),
  );
  const user = userEvent.setup();
  renderWithProviders(<CommentCard comment={mkComment({ id:'c1' })} />);
  await user.click(screen.getByRole('button', { name: /reply/i }));
  await user.type(screen.getByRole('textbox', { name: /reply/i }), 'thanks');
  await user.click(screen.getByRole('button', { name: /send/i }));
  await waitFor(() => screen.getByText(/1 reply sent/i));
  expect(screen.getByText(/addressed/i)).toBeInTheDocument();
});

it('reply error surfaces token-write-scope banner', async () => {
  server.use(
    http.post('/api/comments/c1/reply', () => HttpResponse.json(
      { error: 'token-write-scope', message: 'lacks scope' }, { status: 400 })),
  );
  const user = userEvent.setup();
  renderWithProviders(<CommentCard comment={mkComment({ id:'c1' })} />);
  await user.click(screen.getByRole('button', { name: /reply/i }));
  await user.type(screen.getByRole('textbox', { name: /reply/i }), 'x');
  await user.click(screen.getByRole('button', { name: /send/i }));
  await waitFor(() => screen.getByText(/token may lack write scope/i));
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: ReplyComposer implementation**

```tsx
// apps/web/src/components/ReplyComposer.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

export function ReplyComposer({ commentId, onClose }: { commentId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/comments/${commentId}/reply`, {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ body }),
      });
      const json = await res.json();
      if (!res.ok) throw json;
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments'] });
      qc.invalidateQueries({ queryKey: ['replies', commentId] });
      onClose();
    },
    onError: (err: any) => setError({ code: err.error, message: err.message }),
  });

  return (
    <div className="mt-2 border-t pt-2 space-y-2">
      <Textarea aria-label="Reply" value={body} onChange={(e)=>setBody(e.target.value)}
        rows={3} placeholder="Type your reply..." />
      <div className="text-xs text-muted-foreground">{body.length}/10000</div>
      {error && (
        <div className="text-sm text-red-600 border border-red-200 rounded p-2">
          {error.code === 'token-write-scope'
            ? <>Token may lack write scope. <Link to="/sources" className="underline">Update token</Link>.</>
            : error.message}
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!body.trim() || send.isPending}
          onClick={() => send.mutate()}>
          {send.isPending ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: CommentCard changes**

```tsx
// apps/web/src/components/CommentCard.tsx (excerpt)
import { ReplyComposer } from './ReplyComposer';
import { useQuery } from '@tanstack/react-query';

const [showComposer, setShowComposer] = useState(false);
const replies = useQuery({
  queryKey: ['replies', comment.id],
  queryFn: () => fetch(`/api/comments/${comment.id}/replies`).then(r => r.json()),
});

// In JSX:
<Button variant="ghost" onClick={() => setShowComposer(s => !s)}>Reply</Button>
{(replies.data ?? []).length > 0 && (
  <Badge variant="outline">{replies.data.length} reply sent</Badge>
)}
{showComposer && <ReplyComposer commentId={comment.id} onClose={() => setShowComposer(false)} />}
```

- [ ] **Step 5: Tests pass; commit**

```bash
git add apps/web
git commit -m "feat(web): inline reply composer + reply pill + scope error banner"
```

---

### Task 7: E2E reply flow

**Files:** `apps/web/e2e/reply.spec.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from '@playwright/test';
import { loginAs, seedComment } from './helpers';

test('reply from dashboard marks comment addressed', async ({ page }) => {
  await page.route('**/api/comments/test-1/reply', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({
      reply: { id:1, commentId:'test-1', body:'thanks', sentAt:'2025-01-01T00:00:00Z',
        source:'github', sourceResponseId:'1', sourceUrl:'https://x/1' },
      status: 'addressed',
    })}));
  await seedComment(page, { id:'test-1', source:'github' });
  await loginAs(page);
  await page.goto('/');
  await page.getByRole('button', { name: /reply/i }).first().click();
  await page.getByRole('textbox', { name: /reply/i }).fill('thanks');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.getByText(/1 reply sent/i)).toBeVisible();
  await expect(page.getByText(/addressed/i)).toBeVisible();
});

test('reply with bad scope shows banner', async ({ page }) => {
  await page.route('**/api/comments/test-2/reply', (route) =>
    route.fulfill({ status: 400, body: JSON.stringify({
      error:'token-write-scope', message:'lacks scope' })}));
  await seedComment(page, { id:'test-2', source:'github' });
  await loginAs(page);
  await page.goto('/');
  await page.getByRole('button', { name: /reply/i }).first().click();
  await page.getByRole('textbox', { name: /reply/i }).fill('x');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.getByText(/token may lack write scope/i)).toBeVisible();
});
```

- [ ] **Step 2: Pass; commit**

```bash
git add apps/web/e2e
git commit -m "test(web): E2E reply success + scope-error flows"
```

---

## Self-Review Notes

- The route `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` is the canonical GitHub endpoint for threaded PR review replies. URL discriminator chooses between this and the generic issue-comment endpoint.
- `sourceConfigRepo.getGithubFor` and `jiraSiteRepo.getForRepoOrProject` are new helper methods - included in Task 5 step 5. Repositories were defined in Phase 2 and Phase 4 respectively.
- `commentRepo.get(id)` must return `commentUrl`, `issueKey`, `repoOrProject`, `source`. Verify Phase 1 + Phase 4 schema exposes those. If `notified_comments` schema does not include `comment_url` column under that exact name, adjust mapping. Flag during implementation.
- `currentUserId(req)` is a Fastify decorator added in Phase 2 to extract user id from the session. Reused here for `comment_status.set` audit field.
- Phase 2's `comment_status` PRIMARY KEY is presumed `comment_id`; if the schema instead allows history rows, use the latest by `updated_at`.
- The reply text length cap (10000) matches GitHub's REST limit; JIRA's is much higher but enforcing the lower limit keeps behavior uniform.
