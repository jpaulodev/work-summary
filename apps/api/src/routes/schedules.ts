import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidCron, nextOccurrences } from '@work-summary/scheduler';
import { authed } from '../plugins/auth-guard.js';

const CreateSchema = z.object({
  name: z.string().min(1).max(64),
  cronExpression: z.string().refine((s) => isValidCron(s), 'invalid cron expression'),
  timezone: z.string().default('UTC'),
  reposFilter: z.array(z.string()).nullable().default(null),
  enabled: z.boolean().default(true),
});

const UpdateSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    cronExpression: z
      .string()
      .refine((s) => isValidCron(s), 'invalid cron expression')
      .optional(),
    timezone: z.string().optional(),
    reposFilter: z.array(z.string()).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export default function schedulesRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    '/schedules',
    authed(() => app.scheduleRepo.list()),
  );

  app.post(
    '/schedules',
    authed((req, reply) => {
      const body = CreateSchema.parse(req.body);
      const row = app.scheduleRepo.insert({ id: randomUUID(), ...body });
      app.scheduleEngine.upsert(row.id);
      return reply.code(201).send(row);
    }),
  );

  app.put(
    '/schedules/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      if (!app.scheduleRepo.get(id)) return reply.code(404).send({ error: 'not found' });
      const patch = UpdateSchema.parse(req.body);
      const row = app.scheduleRepo.update(id, patch);
      app.scheduleEngine.upsert(id);
      return row;
    }),
  );

  app.delete(
    '/schedules/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      app.scheduleRepo.delete(id);
      app.scheduleEngine.remove(id);
      return reply.code(204).send();
    }),
  );

  app.get(
    '/schedules/:id/preview',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const row = app.scheduleRepo.get(id);
      if (!row) return reply.code(404).send({ error: 'not found' });
      return { next: nextOccurrences(row.cronExpression, row.timezone, 5, new Date()) };
    }),
  );
  done();
}
