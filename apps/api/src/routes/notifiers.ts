import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createNotifierConfigRepo } from '@work-summary/config-db';
import { SmtpNotifier } from '@work-summary/notifiers';
import { authed } from '../plugins/auth-guard.js';

const PutSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  secure: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subjectTemplate: z.string().optional(),
  secret: z.object({ user: z.string(), pass: z.string() }).optional(),
});

export default function notifiersRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    '/notifiers',
    authed(() => ({ items: createNotifierConfigRepo(app.db, app.masterKey).list() })),
  );

  app.put(
    '/notifiers/:id',
    authed((req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = PutSchema.parse(req.body);
      const { secret, ...config } = body;
      createNotifierConfigRepo(app.db, app.masterKey).put(id, {
        ...config,
        ...(secret ? { user: secret.user, pass: secret.pass } : {}),
      });
      return { ok: true };
    }),
  );

  app.post(
    '/notifiers/:id/test',
    authed(async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const full = createNotifierConfigRepo(app.db, app.masterKey).get(id);
      if (!full) return reply.code(404).send({ error: 'notifier not found' });
      const notifier = new SmtpNotifier({
        host: full.host,
        port: full.port,
        secure: full.secure,
        user: full.user,
        pass: full.pass,
        from: full.from,
        to: full.to,
      });
      try {
        await notifier.verify();
        return { ok: true };
      } catch (err) {
        return reply
          .code(502)
          .send({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
  done();
}
