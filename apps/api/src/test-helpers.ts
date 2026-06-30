import { randomBytes } from 'node:crypto';
import { openDatabase, runMigrations } from '@work-summary/storage';
import type { SqliteDatabase } from '@work-summary/storage';
import { buildServer } from './server.js';

export const TEST_KEY = randomBytes(32);
export const TEST_SESSION_SECRET = randomBytes(32);

export async function makeTestApp(): Promise<{
  app: Awaited<ReturnType<typeof buildServer>>;
  db: SqliteDatabase;
}> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const app = await buildServer({
    db,
    masterKey: TEST_KEY,
    sessionSecret: TEST_SESSION_SECRET,
    now: () => new Date('2026-06-01T00:00:00Z'),
  });
  return { app, db };
}

/** Bootstraps a user, logs in, and returns the cookie header string. */
export async function authedCookie(app: Awaited<ReturnType<typeof buildServer>>): Promise<string> {
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
  const cookie = login.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie.join('; ') : (cookie ?? '');
}
