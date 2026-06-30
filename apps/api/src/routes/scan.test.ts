import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { createOAuthConnectionService } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;
beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});

describe('scan routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scan' });
    expect(res.statusCode).toBe(401);
  });

  it('scan/status reports not running initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/scan/status', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ running: boolean }>().running).toBe(false);
  });

  it('400 when no source is connected', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scan', headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/no source connected/i);
  });

  it('runs with NO notifier configured (comments still reach the dashboard)', async () => {
    // GitHub connected but no repos and no notifier: the scan must complete (the
    // dashboard, not a digest, is the point) rather than fail "no enabled notifier".
    createOAuthConnectionService(db, TEST_KEY).save(1, 'github', {
      accessToken: 'gho_token',
      accountLogin: 'octocat',
    });
    const res = await app.inject({ method: 'POST', url: '/api/scan', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ runId: number }>().runId).toBeGreaterThan(0);
  });
});
