import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminOnly } from '../plugins/auth-guard.js';

const CreateSchema = z.object({
  email: z.string().email().nullable().optional(),
  role: z.enum(['admin', 'member']).default('member'),
});

interface InviteRow {
  id: string;
  token: string;
  email: string | null;
  role: string;
  created_at: string;
  expires_at: string;
  consumed_by: number | null;
  consumed_at: string | null;
}

/** Invites expire 7 days after creation. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export default function invitesRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.post(
    '/invites',
    adminOnly((req, reply) => {
      const body = CreateSchema.parse(req.body);
      const id = randomUUID();
      const token = randomBytes(24).toString('hex');
      const createdAt = app.now();
      const expiresAt = new Date(createdAt.getTime() + INVITE_TTL_MS).toISOString();
      app.db
        .prepare(
          `INSERT INTO invite (id, token, email, role, created_by, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          token,
          body.email ?? null,
          body.role,
          req.userId,
          createdAt.toISOString(),
          expiresAt,
        );
      return reply.code(201).send({ id, token, role: body.role, expiresAt });
    }),
  );

  app.get(
    '/invites',
    adminOnly(() => {
      const rows = app.db
        .prepare(
          `SELECT id, token, email, role, created_at AS createdAt, expires_at AS expiresAt,
             consumed_by AS consumedBy, consumed_at AS consumedAt
           FROM invite ORDER BY created_at DESC`,
        )
        .all() as Array<Record<string, unknown>>;
      return { items: rows };
    }),
  );

  app.delete(
    '/invites/:id',
    adminOnly((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      app.db.prepare('DELETE FROM invite WHERE id = ? AND consumed_by IS NULL').run(id);
      return reply.code(204).send();
    }),
  );

  done();
}

/** Shared by the register route: validate a token and return the live invite. */
export function findUsableInvite(
  app: FastifyInstance,
  token: string,
): InviteRow | { error: 'invalid-invite' | 'expired-invite' } {
  const invite = app.db.prepare('SELECT * FROM invite WHERE token = ?').get(token) as
    InviteRow | undefined;
  if (!invite || invite.consumed_by !== null) return { error: 'invalid-invite' };
  if (new Date(invite.expires_at).getTime() < app.now().getTime()) {
    return { error: 'expired-invite' };
  }
  return invite;
}
