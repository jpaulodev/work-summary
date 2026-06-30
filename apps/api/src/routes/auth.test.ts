import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp } from '../test-helpers.js';

let app: Awaited<ReturnType<typeof makeTestApp>>['app'];
beforeEach(async () => {
  ({ app } = await makeTestApp());
});

describe('auth', () => {
  it('bootstrap creates user when none exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'pw1234567' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('bootstrap refuses second call', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'pw1234567' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'pw1234567' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('bootstrap 400 on short password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('login sets cookie and /me returns user', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'pw1234567' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'me', password: 'pw1234567' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.headers['set-cookie'];
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie! },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ username: 'me' });
  });

  it('login 401 on wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/bootstrap',
      payload: { username: 'me', password: 'pw1234567' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'me', password: 'wrongpass' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('/me 401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('open registration creates a user and a session, no invite needed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: 'pw1234567' },
    });
    expect(res.statusCode).toBe(201);
    // The signup logs the new user straight in.
    const cookie = res.headers['set-cookie'];
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie! },
    });
    expect(me.json()).toMatchObject({ username: 'alice' });
  });

  it('register 409 when the username is taken', async () => {
    const payload = { username: 'bob', password: 'pw1234567' };
    await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('username-taken');
  });

  it('register 403 when DISABLE_REGISTRATION is set', async () => {
    process.env.DISABLE_REGISTRATION = 'true';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'carol', password: 'pw1234567' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('registration-disabled');
    } finally {
      delete process.env.DISABLE_REGISTRATION;
    }
  });
});
