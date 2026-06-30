import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, authedCookie } from '../test-helpers.js';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
let cookie: string;
beforeEach(async () => {
  ({ app } = await makeTestApp());
  cookie = await authedCookie(app);
});

describe('/api/schedules', () => {
  it('401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/schedules' });
    expect(res.statusCode).toBe(401);
  });

  it('POST creates a schedule and registers it in the engine', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie },
      payload: { name: 'morning', cronExpression: '0 9 * * 1-5' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; cronExpression: string; enabled: boolean }>();
    expect(body.cronExpression).toBe('0 9 * * 1-5');
    expect(body.enabled).toBe(true);
    expect(app.scheduleEngine.has(body.id)).toBe(true);
  });

  it('POST rejects an invalid cron with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie },
      payload: { name: 'bad', cronExpression: 'not-a-cron' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /:id/preview returns the next 5 occurrences', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie },
      payload: { name: 'hourly', cronExpression: '0 * * * *' },
    });
    const id = create.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'GET',
      url: `/api/schedules/${id}/preview`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ next: string[] }>().next).toHaveLength(5);
  });

  it('PUT toggles enabled and deregisters when disabled', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie },
      payload: { name: 'x', cronExpression: '0 * * * *' },
    });
    const id = create.json<{ id: string }>().id;
    expect(app.scheduleEngine.has(id)).toBe(true);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/schedules/${id}`,
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(app.scheduleEngine.has(id)).toBe(false);
  });

  it('DELETE removes the schedule', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/schedules',
      headers: { cookie },
      payload: { name: 'x', cronExpression: '0 * * * *' },
    });
    const id = create.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/schedules/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(app.scheduleEngine.has(id)).toBe(false);
    const list = await app.inject({ method: 'GET', url: '/api/schedules', headers: { cookie } });
    expect(list.json<unknown[]>()).toHaveLength(0);
  });
});
