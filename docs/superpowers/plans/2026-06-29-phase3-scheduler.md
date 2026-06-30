# Phase 3 - Built-in Configurable Scheduler - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add in-process configurable scheduler (UI-managed) so users can run scans on cron-style schedules without OS cron.

**Architecture:** New `packages/scheduler` wrapping node-cron, plus migration 0003 (schedules table + runs.triggered_by). API exposes `/api/schedules` CRUD. Web exposes "Schedules" screen with preset + custom cron + preview.

**Tech Stack:** node-cron ^3, cron-parser ^4, react-hook-form, shadcn/ui dialog/select.

## Global Constraints
- Single-process scheduling (in API process).
- All timers must be disposed on graceful shutdown.
- Use `runScan` from `@work-summary/core` (Phase 1) - do not duplicate scan logic.
- Schedules persisted in SQLite (Phase 2 db).
- Concurrent scans prevented via the same single-flight lock used by manual scan.

---

### Task 1: Migration 0003 (schedules + triggered_by)

**Files:**
- Create: `packages/storage/src/migrations/0003_schedules.sql`
- Modify: `packages/storage/src/db.ts` (register migration)
- Test: `packages/storage/test/migration-0003.test.ts`

**Interfaces:**
- Produces: `schedules` table per spec section 4; `runs.triggered_by` column.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/db';

describe('migration 0003', () => {
  let db: Database.Database;
  beforeEach(() => { db = initDb(':memory:'); });

  it('creates schedules table', () => {
    const cols = db.prepare("PRAGMA table_info(schedules)").all() as { name: string }[];
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual([
      'created_at','cron_expression','enabled','id','last_run_at','last_run_id',
      'name','next_run_at','repos_filter','timezone','updated_at'
    ]);
  });

  it('adds triggered_by to runs', () => {
    const cols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
    expect(cols.find(c => c.name === 'triggered_by')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, see failure** - `pnpm --filter @work-summary/storage test migration-0003` expects schema not present.

- [ ] **Step 3: Create migration SQL**

```sql
-- packages/storage/src/migrations/0003_schedules.sql
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  repos_filter TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_id INTEGER,
  next_run_at TEXT
);
CREATE INDEX idx_schedules_enabled ON schedules(enabled);
ALTER TABLE runs ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'manual';
```

- [ ] **Step 4: Register in db.ts** - add `'0003_schedules.sql'` to the migrations array.

- [ ] **Step 5: Tests pass; commit**

```bash
git add packages/storage
git commit -m "feat(storage): migration 0003 (schedules + runs.triggered_by)"
```

---

### Task 2: ScheduleRepository

**Files:**
- Create: `packages/storage/src/schedule-repository.ts`
- Test: `packages/storage/test/schedule-repository.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ScheduleRow {
  id: string; name: string; enabled: boolean;
  cronExpression: string; timezone: string;
  reposFilter: string[] | null;
  createdAt: string; updatedAt: string;
  lastRunAt: string | null; lastRunId: number | null; nextRunAt: string | null;
}
export class ScheduleRepository {
  constructor(db: Database.Database);
  list(): ScheduleRow[];
  get(id: string): ScheduleRow | null;
  insert(row: Omit<ScheduleRow,'createdAt'|'updatedAt'|'lastRunAt'|'lastRunId'|'nextRunAt'>): ScheduleRow;
  update(id: string, patch: Partial<ScheduleRow>): ScheduleRow;
  delete(id: string): void;
  markRun(id: string, runId: number, ranAt: string, nextRunAt: string): void;
}
```

- [ ] **Step 1: Failing test**

```ts
it('inserts and lists', () => {
  const repo = new ScheduleRepository(db);
  repo.insert({ id: 's1', name: 'weekday-9am', enabled: true,
    cronExpression: '0 9 * * 1-5', timezone: 'UTC', reposFilter: null });
  expect(repo.list()).toHaveLength(1);
  expect(repo.list()[0].cronExpression).toBe('0 9 * * 1-5');
});

it('serializes reposFilter as JSON', () => {
  const repo = new ScheduleRepository(db);
  repo.insert({ id: 's2', name: 'x', enabled: true,
    cronExpression: '* * * * *', timezone: 'UTC',
    reposFilter: ['owner/repo1'] });
  expect(repo.get('s2')!.reposFilter).toEqual(['owner/repo1']);
});
```

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implementation**

```ts
import type Database from 'better-sqlite3';

export class ScheduleRepository {
  constructor(private db: Database.Database) {}

  private parseRow(r: any): ScheduleRow {
    return {
      id: r.id, name: r.name, enabled: r.enabled === 1,
      cronExpression: r.cron_expression, timezone: r.timezone,
      reposFilter: r.repos_filter ? JSON.parse(r.repos_filter) : null,
      createdAt: r.created_at, updatedAt: r.updated_at,
      lastRunAt: r.last_run_at, lastRunId: r.last_run_id, nextRunAt: r.next_run_at,
    };
  }

  list(): ScheduleRow[] {
    return this.db.prepare('SELECT * FROM schedules ORDER BY name').all().map((r:any)=>this.parseRow(r));
  }

  get(id: string): ScheduleRow | null {
    const r = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    return r ? this.parseRow(r) : null;
  }

  insert(row: Omit<ScheduleRow,'createdAt'|'updatedAt'|'lastRunAt'|'lastRunId'|'nextRunAt'>): ScheduleRow {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO schedules
      (id,name,enabled,cron_expression,timezone,repos_filter,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      row.id, row.name, row.enabled ? 1 : 0, row.cronExpression, row.timezone,
      row.reposFilter ? JSON.stringify(row.reposFilter) : null, now, now);
    return this.get(row.id)!;
  }

  update(id: string, patch: Partial<ScheduleRow>): ScheduleRow {
    const cur = this.get(id);
    if (!cur) throw new Error(`Schedule ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare(`UPDATE schedules SET
      name=?, enabled=?, cron_expression=?, timezone=?, repos_filter=?, updated_at=?
      WHERE id=?`).run(
      next.name, next.enabled?1:0, next.cronExpression, next.timezone,
      next.reposFilter ? JSON.stringify(next.reposFilter) : null,
      next.updatedAt, id);
    return this.get(id)!;
  }

  delete(id: string) { this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id); }

  markRun(id: string, runId: number, ranAt: string, nextRunAt: string) {
    this.db.prepare(`UPDATE schedules SET last_run_id=?, last_run_at=?, next_run_at=?, updated_at=?
      WHERE id=?`).run(runId, ranAt, nextRunAt, new Date().toISOString(), id);
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): ScheduleRepository"
```

---

### Task 3: packages/scheduler engine

**Files:**
- Create: `packages/scheduler/package.json`, `tsconfig.json`, `src/index.ts`, `src/engine.ts`
- Test: `packages/scheduler/test/engine.test.ts`

**Interfaces:**
- Consumes: `ScheduleRepository` (Task 2), `runScan` from `@work-summary/core`, `RunRepository` (Phase 1).
- Produces:
```ts
export interface ScheduleEngineDeps {
  scheduleRepo: ScheduleRepository;
  runScan: (opts: { configOverride?: Partial<Config>; triggeredBy: string }) => Promise<{ runId: number }>;
}
export class ScheduleEngine {
  constructor(deps: ScheduleEngineDeps);
  start(): void;
  stop(): void;
  upsert(id: string): void;
  remove(id: string): void;
}
```

- [ ] **Step 1: Setup package**

```json
{
  "name": "@work-summary/scheduler",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": { "build": "tsc -b", "test": "vitest run" },
  "dependencies": {
    "node-cron": "^3.0.3",
    "cron-parser": "^4.9.0",
    "@work-summary/core": "workspace:*",
    "@work-summary/storage": "workspace:*"
  },
  "devDependencies": { "vitest": "^1.6.0", "typescript": "^5.4.0", "@types/node-cron": "^3.0.11" }
}
```

- [ ] **Step 2: Failing test with fake timers**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleEngine } from '../src/engine';
import { ScheduleRepository } from '@work-summary/storage';
import { initDb } from '@work-summary/storage';

describe('ScheduleEngine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invokes runScan when cron tick fires', async () => {
    const db = initDb(':memory:');
    const repo = new ScheduleRepository(db);
    repo.insert({ id: 's1', name: 'every-min', enabled: true,
      cronExpression: '* * * * *', timezone: 'UTC', reposFilter: null });
    const runScan = vi.fn(async () => ({ runId: 42 }));
    const engine = new ScheduleEngine({ scheduleRepo: repo, runScan });
    engine.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runScan).toHaveBeenCalledWith(expect.objectContaining({ triggeredBy: 'schedule:s1' }));
    engine.stop();
  });

  it('disabled schedules are not registered', async () => {
    const db = initDb(':memory:');
    const repo = new ScheduleRepository(db);
    repo.insert({ id: 's1', name: 'off', enabled: false,
      cronExpression: '* * * * *', timezone: 'UTC', reposFilter: null });
    const runScan = vi.fn(async () => ({ runId: 1 }));
    new ScheduleEngine({ scheduleRepo: repo, runScan }).start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Implementation**

```ts
// packages/scheduler/src/engine.ts
import cron, { ScheduledTask } from 'node-cron';
import parser from 'cron-parser';
import type { ScheduleRepository, ScheduleRow } from '@work-summary/storage';

export interface ScheduleEngineDeps {
  scheduleRepo: ScheduleRepository;
  runScan: (opts: { configOverride?: any; triggeredBy: string }) => Promise<{ runId: number }>;
}

export class ScheduleEngine {
  private timers = new Map<string, ScheduledTask>();
  constructor(private deps: ScheduleEngineDeps) {}

  start() {
    for (const s of this.deps.scheduleRepo.list()) {
      if (s.enabled) this.register(s);
    }
  }

  stop() {
    for (const t of this.timers.values()) t.stop();
    this.timers.clear();
  }

  upsert(id: string) {
    this.remove(id);
    const s = this.deps.scheduleRepo.get(id);
    if (s && s.enabled) this.register(s);
  }

  remove(id: string) {
    const t = this.timers.get(id);
    if (t) { t.stop(); this.timers.delete(id); }
  }

  private register(s: ScheduleRow) {
    if (!cron.validate(s.cronExpression)) {
      throw new Error(`Invalid cron: ${s.cronExpression}`);
    }
    const task = cron.schedule(s.cronExpression, async () => {
      try {
        const result = await this.deps.runScan({
          configOverride: s.reposFilter ? { repos: s.reposFilter } : undefined,
          triggeredBy: `schedule:${s.id}`,
        });
        const nextRun = parser.parseExpression(s.cronExpression,
          { tz: s.timezone }).next().toISOString();
        this.deps.scheduleRepo.markRun(s.id, result.runId, new Date().toISOString(), nextRun);
      } catch (err) {
        console.error(`[scheduler] tick ${s.id} failed:`, err);
      }
    }, { timezone: s.timezone });
    this.timers.set(s.id, task);
  }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add packages/scheduler
git commit -m "feat(scheduler): ScheduleEngine with node-cron + fake-timer tests"
```

---

### Task 4: API routes /api/schedules

**Files:**
- Create: `apps/api/src/routes/schedules.ts`
- Modify: `apps/api/src/server.ts` (mount routes, wire engine, expose `runScan` helper)
- Test: `apps/api/test/routes/schedules.test.ts`

**Interfaces:**
- Consumes: `ScheduleEngine`, `ScheduleRepository`.
- Produces: REST endpoints per spec section 6.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp } from '../helpers';

describe('/api/schedules', () => {
  it('POST creates a schedule and registers it', async () => {
    const { app, engine } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/api/schedules',
      headers: { cookie: await loginCookie(app) },
      payload: { name: 'morning', cronExpression: '0 9 * * 1-5' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.cronExpression).toBe('0 9 * * 1-5');
    expect(engine.has(body.id)).toBe(true);
  });

  it('POST rejects invalid cron with 400', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST', url: '/api/schedules',
      headers: { cookie: await loginCookie(app) },
      payload: { name: 'bad', cronExpression: 'not-a-cron' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /preview returns next 5 occurrences', async () => {
    const { app } = await buildTestApp();
    const create = await app.inject({ method:'POST', url:'/api/schedules',
      headers:{cookie:await loginCookie(app)},
      payload:{ name:'x', cronExpression:'0 * * * *' }});
    const id = create.json().id;
    const res = await app.inject({ method:'GET', url:`/api/schedules/${id}/preview`,
      headers:{cookie:await loginCookie(app)}});
    expect(res.json().next).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implement route**

```ts
// apps/api/src/routes/schedules.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import cron from 'node-cron';
import parser from 'cron-parser';
import { randomUUID } from 'crypto';

const CreateBody = z.object({
  name: z.string().min(1).max(64),
  cronExpression: z.string().refine(s => cron.validate(s), 'invalid cron'),
  timezone: z.string().default('UTC'),
  reposFilter: z.array(z.string()).nullable().default(null),
  enabled: z.boolean().default(true),
});
const UpdateBody = CreateBody.partial();

export const schedulesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  const repo = app.scheduleRepo;
  const engine = app.scheduleEngine;

  app.get('/', async () => repo.list());

  app.post('/', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const row = repo.insert({ id: randomUUID(), ...body });
    engine.upsert(row.id);
    reply.code(201);
    return row;
  });

  app.put('/:id', async (req) => {
    const id = (req.params as any).id;
    const patch = UpdateBody.parse(req.body);
    const row = repo.update(id, patch);
    engine.upsert(id);
    return row;
  });

  app.delete('/:id', async (req, reply) => {
    const id = (req.params as any).id;
    repo.delete(id);
    engine.remove(id);
    reply.code(204);
  });

  app.get('/:id/preview', async (req) => {
    const id = (req.params as any).id;
    const row = repo.get(id);
    if (!row) throw app.httpErrors.notFound();
    const it = parser.parseExpression(row.cronExpression, { tz: row.timezone });
    return { next: Array.from({ length: 5 }, () => it.next().toISOString()) };
  });
};
```

- [ ] **Step 4: Mount in server.ts**

```ts
// in apps/api/src/server.ts
import { ScheduleRepository } from '@work-summary/storage';
import { ScheduleEngine } from '@work-summary/scheduler';
import { schedulesRoutes } from './routes/schedules';

// after db init:
const scheduleRepo = new ScheduleRepository(db);
const scheduleEngine = new ScheduleEngine({
  scheduleRepo,
  runScan: (opts) => runScanService(opts.triggeredBy, opts.configOverride),
});
app.decorate('scheduleRepo', scheduleRepo);
app.decorate('scheduleEngine', scheduleEngine);
scheduleEngine.start();
app.addHook('onClose', async () => scheduleEngine.stop());

app.register(schedulesRoutes, { prefix: '/api/schedules' });
```

- [ ] **Step 5: Update `runScan` service to set `runs.triggered_by`**

```ts
// in apps/api/src/services/scan-runner.ts
export async function runScanService(triggeredBy = 'manual', configOverride?: any) {
  // create run row with triggered_by, then call core runScan with merged config
  const runId = runRepo.insert({ triggeredBy, status: 'running', startedAt: new Date().toISOString() });
  try {
    const result = await runScan({ ...config, ...configOverride });
    runRepo.complete(runId, 'success', result);
    return { runId };
  } catch (err) {
    runRepo.complete(runId, 'error', { error: String(err) });
    throw err;
  }
}
```

- [ ] **Step 6: Tests pass**

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): /api/schedules CRUD + preview + engine wiring"
```

---

### Task 5: Web screen "Schedules"

**Files:**
- Create: `apps/web/src/pages/Schedules.tsx`, `apps/web/src/components/ScheduleDialog.tsx`
- Modify: `apps/web/src/App.tsx` (add route + nav link)
- Test: `apps/web/test/Schedules.test.tsx`

**Interfaces:**
- Consumes: `/api/schedules` endpoints.

- [ ] **Step 1: Failing test (RTL)**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schedules } from '../src/pages/Schedules';
import { renderWithProviders } from './helpers';

it('lists schedules and previews next runs', async () => {
  renderWithProviders(<Schedules />);
  await waitFor(() => screen.getByText('morning'));
  expect(screen.getByText(/0 9 \* \* 1-5/)).toBeInTheDocument();
  expect(screen.getByText(/Next:/)).toBeInTheDocument();
});

it('creates a schedule via preset', async () => {
  const user = userEvent.setup();
  renderWithProviders(<Schedules />);
  await user.click(screen.getByRole('button', { name: /new schedule/i }));
  await user.type(screen.getByLabelText('Name'), 'weekday-9am');
  await user.click(screen.getByText('Every weekday at 9 AM'));
  await user.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => screen.getByText('weekday-9am'));
});
```

- [ ] **Step 2: Fail**

- [ ] **Step 3: Implement page**

```tsx
// apps/web/src/pages/Schedules.tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScheduleDialog } from '../components/ScheduleDialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export function Schedules() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => fetch('/api/schedules').then(r => r.json()),
  });
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Schedules</h1>
        <Button onClick={() => setOpen(true)}>+ New schedule</Button>
      </div>
      <div className="grid gap-3">
        {data.map((s: any) => (
          <div key={s.id} className="border rounded p-4 flex justify-between">
            <div>
              <div className="font-medium">{s.name}</div>
              <code className="text-sm text-muted-foreground">{s.cronExpression}</code>
              <div className="text-xs">Next: {s.nextRunAt ?? '-'}</div>
            </div>
            <Switch checked={s.enabled}
              onCheckedChange={(v) => toggle.mutate({ id: s.id, enabled: v })} />
          </div>
        ))}
      </div>
      <ScheduleDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
```

- [ ] **Step 4: Implement dialog**

```tsx
// apps/web/src/components/ScheduleDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const PRESETS = [
  { label: 'Every weekday at 9 AM', cron: '0 9 * * 1-5' },
  { label: '3x daily (9, 13, 17)', cron: '0 9,13,17 * * *' },
  { label: 'Every Monday 8 AM', cron: '0 8 * * 1' },
  { label: 'Every hour', cron: '0 * * * *' },
];

export function ScheduleDialog({ open, onOpenChange }: any) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const create = useMutation({
    mutationFn: (body: any) => fetch('/api/schedules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => { if (!r.ok) throw new Error('bad'); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      onOpenChange(false);
      setName(''); setCron('');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New schedule</DialogTitle></DialogHeader>
        <label className="block">
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2 my-3">
          {PRESETS.map(p => (
            <Button key={p.cron} variant="outline" type="button"
              onClick={() => setCron(p.cron)}>{p.label}</Button>
          ))}
        </div>
        <label className="block">
          <span>Cron expression</span>
          <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * 1-5"/>
        </label>
        <DialogFooter>
          <Button onClick={() => create.mutate({ name, cronExpression: cron })}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Add nav + route in App.tsx**

```tsx
// in App.tsx routes
<Route path="/schedules" element={<Schedules />} />
// in sidebar
<NavLink to="/schedules">Schedules</NavLink>
```

- [ ] **Step 6: Tests pass**

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): Schedules screen + preset/cron dialog"
```

---

### Task 6: E2E smoke test

**Files:**
- Create: `apps/web/e2e/schedules.spec.ts`

- [ ] **Step 1: Test**

```ts
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

test('create schedule then see it in list', async ({ page }) => {
  await loginAs(page);
  await page.goto('/schedules');
  await page.getByRole('button', { name: /new schedule/i }).click();
  await page.getByLabel('Name').fill('weekday-9');
  await page.getByText('Every weekday at 9 AM').click();
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page.getByText('weekday-9')).toBeVisible();
  await expect(page.getByText('0 9 * * 1-5')).toBeVisible();
});
```

- [ ] **Step 2: Run, pass**

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e
git commit -m "test(web): E2E schedules"
```

---

## Self-Review Notes

- Migration 0003 also touches `runs` (column add) - confirmed `ALTER TABLE` works on existing rows because column has DEFAULT 'manual'.
- Single-flight lock for scans is owned by the API's scan-runner service, not the engine. The engine awaits `runScan` so simultaneous ticks queue at the service level.
- `cron-parser` and `node-cron` use the same 5-field syntax; preview and timer agree.
- Engine intentionally swallows tick errors (logged) so a transient failure does not crash the API. Failures still produce a `runs` row with status='error'.
