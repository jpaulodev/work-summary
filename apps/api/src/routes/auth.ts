import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { verifyPassword, signSessionId } from '@work-summary/auth';

const LoginSchema = z.object({ username: z.string(), password: z.string() });

// A fixed argon2id hash verified on the unknown-username path so login takes the
// same time whether or not the username exists (mitigates user enumeration).
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$QCSv2zq5uDP5x4Nm9o6Cjw$84J9v1LXQsRXpVZWRLo5DYJKHEIrS9+jFbz8FjHGaqE';

export default function authRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post('/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);
    const row = app.db
      .prepare('SELECT id, password_hash FROM app_user WHERE username = ?')
      .get(body.username) as { id: number; password_hash: string } | undefined;
    if (!row) {
      await verifyPassword(body.password, DUMMY_HASH);
      return reply.code(401).send({ error: 'invalid' });
    }
    if (!(await verifyPassword(body.password, row.password_hash)))
      return reply.code(401).send({ error: 'invalid' });
    const sid = randomBytes(32).toString('hex');
    const expires = new Date(app.now().getTime() + 14 * 24 * 60 * 60 * 1000);
    app.db
      .prepare('INSERT INTO app_session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sid, row.id, app.now().toISOString(), expires.toISOString());
    void reply.setCookie('ws_session', signSessionId(sid, app.sessionSecret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires,
      path: '/',
    });
    return reply.send({ ok: true });
  });

  app.post('/logout', (req, reply) => {
    const cookie = req.cookies['ws_session'];
    if (cookie) {
      const id = cookie.split('.')[0];
      if (id) app.db.prepare('DELETE FROM app_session WHERE id = ?').run(id);
    }
    void reply.clearCookie('ws_session', { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/me', (req, reply) => {
    if (!req.userId) return reply.code(401).send({ error: 'unauthenticated' });
    const row = app.db.prepare('SELECT username FROM app_user WHERE id = ?').get(req.userId) as
      { username: string } | undefined;
    return reply.send({ username: row?.username });
  });
  done();
}
