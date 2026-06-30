import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie, TEST_KEY } from '../test-helpers.js';
import { createNotifierConfigRepo } from '@work-summary/config-db';
import type { SqliteDatabase } from '@work-summary/storage';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let db: SqliteDatabase;
let cookie: string;
beforeEach(async () => {
  ({ app, db } = await makeTestApp());
  cookie = await authedCookie(app);
});

describe('notifiers routes', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifiers' });
    expect(res.statusCode).toBe(401);
  });

  it('lists notifiers without leaking secrets', async () => {
    createNotifierConfigRepo(db, TEST_KEY).put('primary', {
      enabled: true,
      host: 'smtp.test',
      port: 587,
      secure: false,
      from: 'a@b',
      to: 'c@d',
      subjectTemplate: '[ws]',
      user: 'u',
      pass: 'topsecret',
    });
    const res = await app.inject({ method: 'GET', url: '/api/notifiers', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ id: string; hasSecret: boolean }> }>();
    expect(body.items[0]).toMatchObject({ id: 'primary', hasSecret: true });
    expect(JSON.stringify(body)).not.toContain('topsecret');
  });

  it('PUT updates config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifiers/primary',
      headers: { cookie },
      payload: {
        host: 'smtp.example',
        port: 465,
        secure: true,
        from: 'x@y',
        to: 'z@w',
        subjectTemplate: '[ws] {{count}}',
        secret: { user: 'u', pass: 'p' },
      },
    });
    expect(res.statusCode).toBe(200);
    const got = createNotifierConfigRepo(db, TEST_KEY).get('primary');
    expect(got?.host).toBe('smtp.example');
    expect(got?.pass).toBe('p');
  });
});
