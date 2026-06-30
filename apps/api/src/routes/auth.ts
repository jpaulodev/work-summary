import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { verifyPassword, hashPassword, signSessionId } from '@work-summary/auth';
import { findUsableInvite } from './invites.js';

const LoginSchema = z.object({ username: z.string(), password: z.string() });
const RegisterSchema = z.object({
  token: z.string().min(1),
  username: z.string().min(1).max(64),
  password: z.string().min(8),
});

/** Open a session for a user and set the signed session cookie. */
function startSession(app: FastifyInstance, reply: FastifyReply, userId: number): void {
  const sid = randomBytes(32).toString('hex');
  const expires = new Date(app.now().getTime() + 14 * 24 * 60 * 60 * 1000);
  app.db
    .prepare('INSERT INTO app_session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sid, userId, app.now().toISOString(), expires.toISOString());
  void reply.setCookie('ws_session', signSessionId(sid, app.sessionSecret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
    path: '/',
  });
}

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
    startSession(app, reply, row.id);
    return reply.send({ ok: true });
  });

  app.post('/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);
    const invite = findUsableInvite(app, body.token);
    if ('error' in invite) return reply.code(400).send({ error: invite.error });
    const taken = app.db.prepare('SELECT 1 FROM app_user WHERE username = ?').get(body.username);
    if (taken) return reply.code(409).send({ error: 'username-taken' });
    const hash = await hashPassword(body.password);
    const info = app.db
      .prepare(
        'INSERT INTO app_user (username, password_hash, role, email, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(body.username, hash, invite.role, invite.email, app.now().toISOString());
    const userId = Number(info.lastInsertRowid);
    app.db
      .prepare('UPDATE invite SET consumed_by = ?, consumed_at = ? WHERE id = ?')
      .run(userId, app.now().toISOString(), invite.id);
    startSession(app, reply, userId);
    return reply.code(201).send({ ok: true });
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
    const row = app.db
      .prepare('SELECT username, role FROM app_user WHERE id = ?')
      .get(req.userId) as { username: string; role: string } | undefined;
    return reply.send({ username: row?.username, role: row?.role });
  });
  done();
}
