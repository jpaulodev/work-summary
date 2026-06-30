import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';
import { createRunsRepo } from '@work-summary/storage';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;
beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});

describe('runs routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' });
    expect(res.statusCode).toBe(401);
  });

  it('returns runs newest first', async () => {
    const runs = createRunsRepo(db, 1, () => new Date('2026-06-01T00:00:00Z'));
    const id1 = runs.startRun();
    runs.finishRun(id1, 'success', { commentsFound: 3, commentsNotified: 1 });
    const id2 = runs.startRun();
    runs.finishRun(id2, 'success', { commentsFound: 0, commentsNotified: 0 });
    const res = await app.inject({ method: 'GET', url: '/api/runs', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: number; status: string }> }>();
    expect(body.items.map((r) => r.id)).toEqual([2, 1]);
    expect(body.items[0]?.status).toBe('success');
  });
});
