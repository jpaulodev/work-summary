# Phase 5 - Multi-channel Notifiers (Slack + Teams) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Slack and Teams notifiers via incoming webhooks, alongside SMTP, with per-config test button.

**Architecture:** Two new packages implementing the existing `Notifier` interface. Block Kit for Slack, Adaptive Card for Teams. API extended with `/test` endpoint. Web Notifiers screen extended with type selector.

**Tech Stack:** Native fetch, zod, shadcn/ui Select.

## Global Constraints
- One notifier failure must NOT abort others (fanout is best-effort).
- Webhook URLs encrypted (Phase 2 encryption service).
- All notifiers implement `Notifier` interface from `@work-summary/notifiers`.
- Test endpoint sends a synthetic digest, does NOT touch real comments.

---

### Task 1: (Optional) Migration 0005

**Files:**
- Create: `packages/storage/src/migrations/0005_notifier_kinds.sql`
- Modify: `packages/storage/src/db.ts`
- Test: `packages/storage/test/migration-0005.test.ts`

**Skip this task if** Phase 2's migration 0002 created `notifier_config` without a CHECK constraint on `kind`.

- [ ] **Step 1: Verify Phase 2 schema first**

```bash
grep -A5 "notifier_config" packages/storage/src/migrations/0002_*.sql | grep CHECK
```

- [ ] **Step 2: If CHECK exists, write failing test**

```ts
it('allows kind=slack and kind=teams', () => {
  const db = initDb(':memory:');
  expect(() => db.prepare(`INSERT INTO notifier_config
    (id,kind,name,enabled,encrypted_payload,created_at,updated_at)
    VALUES ('n1','slack','s',1,'x','2025-01-01','2025-01-01')`).run())
    .not.toThrow();
  expect(() => db.prepare(`INSERT INTO notifier_config
    (id,kind,name,enabled,encrypted_payload,created_at,updated_at)
    VALUES ('n2','teams','t',1,'x','2025-01-01','2025-01-01')`).run())
    .not.toThrow();
});
```

- [ ] **Step 3: Migration SQL** (per spec section 4)

- [ ] **Step 4: Tests pass; commit**

```bash
git add packages/storage
git commit -m "feat(storage): migration 0005 (notifier_config supports slack/teams)"
```

---

### Task 2: packages/notifier-slack

**Files:**
- Create: `packages/notifier-slack/package.json`, `tsconfig.json`, `src/index.ts`, `src/slack-notifier.ts`
- Test: `packages/notifier-slack/test/slack-notifier.test.ts`

**Interfaces:**
- Consumes: `Notifier`, `Digest` from `@work-summary/notifiers`.
- Produces:
```ts
export interface SlackNotifierOpts { webhookUrl: string }
export class SlackNotifier implements Notifier {
  readonly kind = 'slack';
  constructor(opts: SlackNotifierOpts);
  send(digest: Digest): Promise<{ messageId?: string }>;
}
```

- [ ] **Step 1: Package scaffolding**

```json
{
  "name": "@work-summary/notifier-slack",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": { "@work-summary/notifiers": "workspace:*" },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.4.0" }
}
```

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackNotifier } from '../src/slack-notifier';

beforeEach(() => { global.fetch = vi.fn(); });

const digest = {
  commentsCount: 2,
  sourcesCount: 1,
  dashboardUrl: 'http://localhost:5173',
  comments: [
    { source:'github', repoOrProject:'me/repo', refNumber:'42',
      url:'https://github.com/me/repo/pull/42#discussion_r1', author:'alice', body:'please review' },
    { source:'jira', repoOrProject:'JIRA :: WS', refNumber:'WS-1',
      url:'https://x.atlassian.net/browse/WS-1', author:'bob', body:'q for you' },
  ],
};

it('POSTs Block Kit payload to webhook URL', async () => {
  (fetch as any).mockResolvedValue(new Response('ok', { status: 200 }));
  await new SlackNotifier({ webhookUrl: 'https://hooks.slack.com/AB/CD' }).send(digest as any);
  expect(fetch).toHaveBeenCalledWith('https://hooks.slack.com/AB/CD', expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ 'content-type': 'application/json' }),
  }));
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(body.text).toMatch(/2 pending comments/);
  expect(body.blocks[0].type).toBe('header');
  expect(body.blocks.some((b:any) => b.type === 'section')).toBe(true);
});

it('throws on non-2xx', async () => {
  (fetch as any).mockResolvedValue(new Response('invalid_payload', { status: 400 }));
  await expect(new SlackNotifier({ webhookUrl:'https://x' }).send(digest as any))
    .rejects.toThrow(/400/);
});
```

- [ ] **Step 3: Fail**

- [ ] **Step 4: Implementation**

```ts
// packages/notifier-slack/src/slack-notifier.ts
import type { Notifier, Digest } from '@work-summary/notifiers';

export interface SlackNotifierOpts { webhookUrl: string }

export class SlackNotifier implements Notifier {
  readonly kind = 'slack';
  constructor(private opts: SlackNotifierOpts) {}

  async send(digest: Digest): Promise<{ messageId?: string }> {
    const payload = buildSlackPayload(digest);
    const res = await fetch(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
    }
    return {};
  }
}

export function buildSlackPayload(digest: Digest) {
  const head = [
    { type: 'header', text: { type: 'plain_text', text: 'Work Summary' }},
    { type: 'section', text: { type: 'mrkdwn',
      text: `*${digest.commentsCount}* pending comments across *${digest.sourcesCount}* sources` }},
    { type: 'divider' },
  ];
  const items = digest.comments.slice(0, 10).map(c => ({
    type: 'section',
    text: { type: 'mrkdwn',
      text: `*<${c.url}|${escapeMrkdwn(c.repoOrProject)} #${c.refNumber}>*\n_${escapeMrkdwn(c.author)}_: ${escapeMrkdwn(c.body.slice(0, 200))}` },
  }));
  const footer = digest.comments.length > 10
    ? { type: 'context', elements: [{ type: 'mrkdwn',
        text: `+ ${digest.comments.length - 10} more comments. <${digest.dashboardUrl}|Open dashboard>` }]}
    : { type: 'context', elements: [{ type: 'mrkdwn', text: `<${digest.dashboardUrl}|Open dashboard>` }]};
  return {
    text: `Work Summary - ${digest.commentsCount} pending comments`,
    blocks: [...head, ...items, footer],
  };
}

function escapeMrkdwn(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add packages/notifier-slack
git commit -m "feat(notifier-slack): Slack webhook notifier with Block Kit payload"
```

---

### Task 3: packages/notifier-teams

**Files:**
- Create: `packages/notifier-teams/package.json`, `tsconfig.json`, `src/index.ts`, `src/teams-notifier.ts`
- Test: `packages/notifier-teams/test/teams-notifier.test.ts`

**Interfaces:**
- Produces: `TeamsNotifier` analogous to `SlackNotifier`.

- [ ] **Step 1: Package scaffolding** (analogous to Task 2 package.json, replace slack -> teams)

- [ ] **Step 2: Failing test**

```ts
it('POSTs Adaptive Card to Teams webhook', async () => {
  (fetch as any).mockResolvedValue(new Response('1', { status: 200 }));
  await new TeamsNotifier({ webhookUrl:'https://outlook.office.com/webhook/XYZ' }).send(digest as any);
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  expect(body.type).toBe('message');
  expect(body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  expect(body.attachments[0].content.type).toBe('AdaptiveCard');
  expect(body.attachments[0].content.version).toBe('1.4');
  const text = JSON.stringify(body.attachments[0].content.body);
  expect(text).toMatch(/2 pending comments/);
});

it('caps comment list to 10 to stay under 28KB', async () => {
  const big = { ...digest, comments: Array(25).fill(digest.comments[0]) };
  (fetch as any).mockResolvedValue(new Response('1', { status: 200 }));
  await new TeamsNotifier({ webhookUrl:'https://x' }).send(big as any);
  const body = JSON.parse((fetch as any).mock.calls[0][1].body);
  const containers = body.attachments[0].content.body.filter((b:any)=>b.type==='Container');
  expect(containers.length).toBeLessThanOrEqual(10);
});
```

- [ ] **Step 3: Fail**

- [ ] **Step 4: Implementation**

```ts
// packages/notifier-teams/src/teams-notifier.ts
import type { Notifier, Digest } from '@work-summary/notifiers';

export interface TeamsNotifierOpts { webhookUrl: string }

export class TeamsNotifier implements Notifier {
  readonly kind = 'teams';
  constructor(private opts: TeamsNotifierOpts) {}

  async send(digest: Digest): Promise<{ messageId?: string }> {
    const payload = buildTeamsPayload(digest);
    const res = await fetch(this.opts.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook returned ${res.status}: ${await res.text()}`);
    }
    return {};
  }
}

export function buildTeamsPayload(digest: Digest) {
  const containers = digest.comments.slice(0, 10).map(c => ({
    type: 'Container',
    items: [
      { type: 'TextBlock', text: `${c.repoOrProject} #${c.refNumber}`, weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: `${c.author}: ${c.body.slice(0, 200)}`, wrap: true, isSubtle: true },
    ],
    selectAction: { type: 'Action.OpenUrl', url: c.url },
  }));
  const overflow = digest.comments.length > 10
    ? [{ type: 'TextBlock',
         text: `+ ${digest.comments.length - 10} more in dashboard`,
         wrap: true, isSubtle: true }]
    : [];
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        type: 'AdaptiveCard',
        version: '1.4',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        body: [
          { type: 'TextBlock', text: 'Work Summary', size: 'Large', weight: 'Bolder' },
          { type: 'TextBlock', text: `${digest.commentsCount} pending comments`, wrap: true },
          ...containers,
          ...overflow,
        ],
        actions: [
          { type: 'Action.OpenUrl', title: 'Open dashboard', url: digest.dashboardUrl },
        ],
      },
    }],
  };
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add packages/notifier-teams
git commit -m "feat(notifier-teams): Teams webhook notifier with Adaptive Card 1.4"
```

---

### Task 4: Notifier factory + scan-runner fanout

**Files:**
- Create: `apps/api/src/services/notifier-factory.ts`
- Modify: `apps/api/src/services/scan-runner.ts` (replace single notifier with fanout)
- Test: `apps/api/test/services/notifier-factory.test.ts`

**Interfaces:**
- Produces:
```ts
export function buildNotifier(config: NotifierConfigRow, encryption: EncryptionService): Notifier;
export async function fanout(notifiers: Notifier[], digest: Digest, logger: Logger): Promise<NotifierResult[]>;
export interface NotifierResult { kind: string; configId: string; ok: boolean; error?: string; durationMs: number }
```

- [ ] **Step 1: Failing test**

```ts
it('one failure does not abort others', async () => {
  const ok = { kind:'slack', send: vi.fn().mockResolvedValue({}) };
  const fail = { kind:'teams', send: vi.fn().mockRejectedValue(new Error('boom')) };
  const ok2 = { kind:'smtp', send: vi.fn().mockResolvedValue({}) };
  const results = await fanout(
    [ok as any, fail as any, ok2 as any],
    { commentsCount: 0, sourcesCount: 0, comments: [], dashboardUrl:'x' } as any,
    console as any,
  );
  expect(results.map(r => r.ok)).toEqual([true, false, true]);
  expect(ok.send).toHaveBeenCalled();
  expect(ok2.send).toHaveBeenCalled();
});

it('builds slack notifier from config', () => {
  const enc = { decrypt: () => JSON.stringify({ webhookUrl: 'https://hooks.slack.com/X' }) } as any;
  const n = buildNotifier({ id:'n1', kind:'slack', name:'s', enabled:true,
    encryptedPayload:'enc', createdAt:'', updatedAt:'' } as any, enc);
  expect(n.kind).toBe('slack');
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation**

```ts
// apps/api/src/services/notifier-factory.ts
import { SmtpNotifier } from '@work-summary/notifiers';
import { SlackNotifier } from '@work-summary/notifier-slack';
import { TeamsNotifier } from '@work-summary/notifier-teams';

export function buildNotifier(config: any, encryption: any) {
  const payload = JSON.parse(encryption.decrypt(config.encryptedPayload));
  switch (config.kind) {
    case 'smtp': return new SmtpNotifier(payload);
    case 'slack': return new SlackNotifier(payload);
    case 'teams': return new TeamsNotifier(payload);
    default: throw new Error(`unknown notifier kind: ${config.kind}`);
  }
}

export interface NotifierResult { kind: string; configId?: string; ok: boolean; error?: string; durationMs: number }

export async function fanout(notifiers: any[], digest: any, logger: any): Promise<NotifierResult[]> {
  const results: NotifierResult[] = [];
  for (const n of notifiers) {
    const start = Date.now();
    try {
      await n.send(digest);
      results.push({ kind: n.kind, ok: true, durationMs: Date.now() - start });
    } catch (err: any) {
      logger.error?.(`notifier ${n.kind} failed: ${err.message}`);
      results.push({ kind: n.kind, ok: false, error: err.message, durationMs: Date.now() - start });
    }
  }
  return results;
}
```

- [ ] **Step 4: Wire into scan-runner**

```ts
// apps/api/src/services/scan-runner.ts (relevant excerpt)
import { buildNotifier, fanout } from './notifier-factory';

const enabledConfigs = notifierRepo.list().filter(n => n.enabled);
const notifiers = enabledConfigs.map(c => ({ config: c, instance: buildNotifier(c, encryption) }));
const results = await fanout(notifiers.map(n => n.instance), digest, logger);
runRepo.attachNotifierResults(runId, results);
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): notifier factory + fanout with isolated failures"
```

---

### Task 5: POST /api/notifiers/:id/test

**Files:**
- Modify: `apps/api/src/routes/notifiers.ts` (add /test endpoint, extend create/update schemas)
- Test: `apps/api/test/routes/notifiers-test.test.ts`

- [ ] **Step 1: Failing test**

```ts
it('POST /:id/test sends a synthetic digest and returns ok', async () => {
  const { app } = await buildTestApp();
  // seed slack notifier (mock fetch to succeed)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));
  const created = await app.inject({ method:'POST', url:'/api/notifiers',
    headers:{ cookie: await loginCookie(app) },
    payload:{ kind:'slack', name:'team-channel', webhookUrl:'https://hooks.slack.com/X' }});
  const id = created.json().id;

  const res = await app.inject({ method:'POST', url:`/api/notifiers/${id}/test`,
    headers:{ cookie: await loginCookie(app) }});
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ ok: true });
});

it('rejects unknown kind in create', async () => {
  const { app } = await buildTestApp();
  const res = await app.inject({ method:'POST', url:'/api/notifiers',
    headers:{ cookie: await loginCookie(app) },
    payload:{ kind:'discord', name:'x', webhookUrl:'https://x' }});
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implementation - extend create/update schema**

```ts
// apps/api/src/routes/notifiers.ts
import { z } from 'zod';
import { buildNotifier } from '../services/notifier-factory';

const SmtpPayload = z.object({
  kind: z.literal('smtp'),
  name: z.string(),
  host: z.string(), port: z.number().int(),
  secure: z.boolean(), user: z.string(),
  pass: z.string(), from: z.string(), to: z.array(z.string()),
});
const SlackPayload = z.object({
  kind: z.literal('slack'),
  name: z.string(),
  webhookUrl: z.string().url().regex(/^https:\/\/hooks\.slack\.com\//, 'must be Slack incoming webhook'),
});
const TeamsPayload = z.object({
  kind: z.literal('teams'),
  name: z.string(),
  webhookUrl: z.string().url(),
});
const CreateBody = z.discriminatedUnion('kind', [SmtpPayload, SlackPayload, TeamsPayload]);

// In POST handler:
const body = CreateBody.parse(req.body);
const { kind, name, ...rest } = body;
const row = notifierRepo.insert({
  id: randomUUID(), kind, name, enabled: true,
  encryptedPayload: encryption.encrypt(JSON.stringify(rest)),
});

// New endpoint:
app.post('/:id/test', async (req) => {
  const id = (req.params as any).id;
  const config = notifierRepo.get(id);
  if (!config) throw app.httpErrors.notFound();
  const notifier = buildNotifier(config, encryption);
  const start = Date.now();
  try {
    await notifier.send({
      commentsCount: 1,
      sourcesCount: 1,
      dashboardUrl: `${req.protocol}://${req.hostname}`,
      comments: [{
        source: 'system', repoOrProject: 'work-summary', refNumber: 'TEST',
        url: `${req.protocol}://${req.hostname}`, author: 'work-summary',
        body: 'This is a test notification from work-summary.',
      }],
    } as any);
    return { ok: true, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, error: err.message, durationMs: Date.now() - start };
  }
});
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): /api/notifiers supports slack/teams + POST /:id/test"
```

---

### Task 6: Web - Notifiers screen type selector + test button

**Files:**
- Modify: `apps/web/src/pages/Notifiers.tsx`, `apps/web/src/components/NotifierDialog.tsx`
- Test: `apps/web/test/Notifiers.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it('add slack notifier flow with test button', async () => {
  const user = userEvent.setup();
  renderWithProviders(<Notifiers />);
  await user.click(screen.getByRole('button', { name: /add notifier/i }));
  await user.click(screen.getByRole('combobox', { name: /type/i }));
  await user.click(screen.getByRole('option', { name: /slack/i }));
  await user.type(screen.getByLabelText(/name/i), 'team-ch');
  await user.type(screen.getByLabelText(/webhook url/i), 'https://hooks.slack.com/X');
  await user.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => screen.getByText('team-ch'));
  await user.click(screen.getByRole('button', { name: /send test/i }));
  await waitFor(() => screen.getByText(/test sent/i));
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Update NotifierDialog with type-driven fields**

```tsx
// apps/web/src/components/NotifierDialog.tsx (excerpt)
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const [kind, setKind] = useState<'smtp' | 'slack' | 'teams'>('smtp');
const [name, setName] = useState('');
const [smtp, setSmtp] = useState({ host:'', port:587, secure:false, user:'', pass:'', from:'', to:'' });
const [webhookUrl, setWebhookUrl] = useState('');

const save = useMutation({
  mutationFn: () => {
    const base = { kind, name };
    const body = kind === 'smtp'
      ? { ...base, ...smtp, to: smtp.to.split(',').map(s=>s.trim()).filter(Boolean) }
      : { ...base, webhookUrl };
    return fetch('/api/notifiers', {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify(body),
    }).then(r => { if (!r.ok) throw new Error('save failed'); return r.json(); });
  },
  onSuccess: () => { qc.invalidateQueries({ queryKey:['notifiers'] }); onOpenChange(false); },
});

// In JSX:
<label>
  <span>Type</span>
  <Select value={kind} onValueChange={(v:any) => setKind(v)}>
    <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="smtp">SMTP (Email)</SelectItem>
      <SelectItem value="slack">Slack</SelectItem>
      <SelectItem value="teams">Teams</SelectItem>
    </SelectContent>
  </Select>
</label>
<label><span>Name</span><Input value={name} onChange={e=>setName(e.target.value)} /></label>
{kind === 'smtp' && <SmtpFields value={smtp} onChange={setSmtp} />}
{(kind === 'slack' || kind === 'teams') && (
  <label>
    <span>Webhook URL</span>
    <Input value={webhookUrl} onChange={e=>setWebhookUrl(e.target.value)} />
  </label>
)}
```

- [ ] **Step 4: Add "Send test" button per row in Notifiers.tsx**

```tsx
function NotifierRow({ n }: any) {
  const [result, setResult] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: () => fetch(`/api/notifiers/${n.id}/test`, { method:'POST' })
      .then(r => r.json()),
    onSuccess: (r) => setResult(r.ok ? 'Test sent' : `Failed: ${r.error}`),
  });
  return (
    <div className="border rounded p-4 flex justify-between">
      <div>
        <div className="font-medium">{n.name}</div>
        <div className="text-xs text-muted-foreground">{n.kind}</div>
        {result && <div className="text-xs mt-1">{result}</div>}
      </div>
      <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? 'Sending...' : 'Send test'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): Notifiers type selector (smtp/slack/teams) + Send test button"
```

---

### Task 7: E2E

**Files:** `apps/web/e2e/notifiers.spec.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test('add slack notifier and run test', async ({ page }) => {
  await page.route('**/api/notifiers', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ status: 201, body: JSON.stringify({
        id:'n1', kind:'slack', name:'team-ch', enabled:true })});
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/notifiers/n1/test', (route) =>
    route.fulfill({ json: { ok: true, durationMs: 100 }}));

  await loginAs(page);
  await page.goto('/notifiers');
  await page.getByRole('button', { name: /add notifier/i }).click();
  await page.getByLabel('Type').click();
  await page.getByRole('option', { name: /slack/i }).click();
  await page.getByLabel(/name/i).fill('team-ch');
  await page.getByLabel(/webhook url/i).fill('https://hooks.slack.com/X');
  await page.getByRole('button', { name: /save/i }).click();
  await page.getByRole('button', { name: /send test/i }).click();
  await expect(page.getByText(/test sent/i)).toBeVisible();
});
```

- [ ] **Step 2: Pass; commit**

```bash
git add apps/web/e2e
git commit -m "test(web): E2E Slack notifier add + test"
```

---

## Self-Review Notes

- Phase 1 only defined an `SmtpNotifier` and a `Notifier` interface. The `Digest` type may need a small extension to include `dashboardUrl` if Phase 1 omitted it. If so, add a Step 0 in Task 2: extend `Digest` in `@work-summary/notifiers/src/types.ts` and update SmtpNotifier templates to include the dashboard link. Either way, the type is additive (non-breaking).
- Slack webhook URL validation uses regex; this prevents accidentally pasting non-Slack URLs. Teams URL has no such standard pattern; we accept any HTTPS URL.
- The `escapeMrkdwn` helper handles only the three Slack-significant characters per Slack docs. No need to escape backslash or asterisk in mrkdwn context.
- Notifier results are stored in the `runs` table; this requires `RunRepository.attachNotifierResults` which may need a small `runs.notifier_results_json` column. If absent, add a Step 0 task: migration 0006 adding that column. Flagged here so it surfaces during implementation.
