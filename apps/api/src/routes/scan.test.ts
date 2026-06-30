import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let cookie: string;
beforeEach(async () => {
  ({ app } = await makeTestApp());
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

  it('400 when github is not configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/scan', headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain('github not configured');
  });
});
