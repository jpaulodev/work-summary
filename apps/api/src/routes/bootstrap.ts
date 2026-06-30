import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '@work-summary/auth';

const BodySchema = z.object({ username: z.string().min(1), password: z.string().min(8) });

export default function bootstrapRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.post('/bootstrap', async (req, reply) => {
    const body = BodySchema.parse(req.body);
    const exists = app.db.prepare('SELECT 1 FROM app_user WHERE id = 1').get();
    if (exists) return reply.code(409).send({ error: 'Already bootstrapped' });
    const hash = await hashPassword(body.password);
    app.db
      .prepare('INSERT INTO app_user (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)')
      .run(body.username, hash, app.now().toISOString());
    return reply.code(201).send({ ok: true });
  });
  done();
}
