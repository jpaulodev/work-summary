import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createNotifierConfigRepo, type NotifierInput } from '@work-summary/config-db';
import { SmtpNotifier, type NotificationPayload } from '@work-summary/notifiers';
import { authed } from '../plugins/auth-guard.js';
import { buildNotifier } from '../notifier-factory.js';

const SmtpCreate = z.object({
  type: z.literal('smtp'),
  name: z.string().min(1).max(64),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  from: z.string().min(1),
  to: z.string().min(1),
  subjectTemplate: z.string().min(1).optional(),
  secret: z.object({ user: z.string(), pass: z.string() }),
});
const SlackCreate = z.object({
  type: z.literal('slack'),
  name: z.string().min(1).max(64),
  webhookUrl: z
    .string()
    .url()
    .regex(/^https:\/\/hooks\.slack\.com\//, 'must be a Slack incoming webhook'),
});
const TeamsCreate = z.object({
  type: z.literal('teams'),
  name: z.string().min(1).max(64),
  // Restrict to known Teams / Power Automate webhook hosts to limit SSRF surface.
  webhookUrl: z
    .string()
    .url()
    .regex(
      /^https:\/\/([a-z0-9-]+\.)*(office\.com|azure\.com|powerplatform\.com)\//i,
      'must be a Microsoft Teams or Power Automate webhook',
    ),
});
const CreateSchema = z.discriminatedUnion('type', [SmtpCreate, SlackCreate, TeamsCreate]);

const PutSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  secure: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subjectTemplate: z.string().optional(),
  secret: z.object({ user: z.string(), pass: z.string() }).optional(),
  webhookUrl: z.string().url().optional(),
});

function createInput(body: z.infer<typeof CreateSchema>): NotifierInput {
  if (body.type === 'smtp') {
    return {
      type: 'smtp',
      name: body.name,
      enabled: true,
      host: body.host,
      port: body.port,
      secure: body.secure,
      from: body.from,
      to: body.to,
      user: body.secret.user,
      pass: body.secret.pass,
      ...(body.subjectTemplate ? { subjectTemplate: body.subjectTemplate } : {}),
    };
  }
  return { type: body.type, name: body.name, enabled: true, webhookUrl: body.webhookUrl };
}

const TEST_PAYLOAD: NotificationPayload = {
  subject: '[work-summary] test notification',
  comments: [
    {
      id: 'test',
      source: 'github',
      repo: 'work-summary/test',
      containerType: 'pr',
      containerNumber: 1,
      containerTitle: 'Test',
      containerUrl: 'https://github.com/work-summary/test/pull/1',
      commentId: 'test',
      commentUrl: 'https://github.com/work-summary/test/pull/1',
      author: { login: 'work-summary', isBot: true },
      body: 'This is a test notification from work-summary.',
      createdAt: '2026-06-01T00:00:00Z',
      matchedRules: ['mentioned'],
    },
  ],
  generatedAt: '2026-06-01T00:00:00Z',
};

export default function notifiersRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    '/notifiers',
    authed((req) => ({
      items: createNotifierConfigRepo(app.db, app.masterKey, req.userId as number).list(),
    })),
  );

  app.post(
    '/notifiers',
    authed((req, reply) => {
      const body = CreateSchema.parse(req.body);
      const id = randomUUID();
      createNotifierConfigRepo(app.db, app.masterKey, req.userId as number).put(
        id,
        createInput(body),
      );
      return reply.code(201).send({ id, type: body.type, name: body.name, enabled: true });
    }),
  );

  app.put(
    '/notifiers/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const repo = createNotifierConfigRepo(app.db, app.masterKey, req.userId as number);
      const existing = repo.get(id);
      const body = PutSchema.parse(req.body);
      // For an existing record, reject fields that do not belong to its type so a
      // PUT cannot corrupt a webhook record with SMTP creds (or vice versa). PUT
      // still upserts (creates an smtp notifier) when the id is new.
      if (existing && existing.type === 'smtp' && body.webhookUrl !== undefined) {
        return reply.code(400).send({ error: 'webhookUrl not valid for an smtp notifier' });
      }
      if (existing && existing.type !== 'smtp' && body.secret !== undefined) {
        return reply.code(400).send({ error: 'secret not valid for a webhook notifier' });
      }
      const { secret, ...config } = body;
      repo.put(id, {
        ...config,
        ...(secret ? { user: secret.user, pass: secret.pass } : {}),
      });
      return { ok: true };
    }),
  );

  app.delete(
    '/notifiers/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      createNotifierConfigRepo(app.db, app.masterKey, req.userId as number).delete(id);
      return reply.code(204).send();
    }),
  );

  app.post(
    '/notifiers/:id/test',
    authed(async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const full = createNotifierConfigRepo(app.db, app.masterKey, req.userId as number).get(id);
      if (!full) return reply.code(404).send({ error: 'notifier not found' });
      try {
        if (full.type === 'smtp') {
          // For SMTP, verify the connection rather than delivering a real email.
          await new SmtpNotifier({
            host: full.host,
            port: full.port,
            secure: full.secure,
            user: full.user,
            pass: full.pass,
            from: full.from,
            to: full.to,
          }).verify();
        } else {
          await buildNotifier(full).send(TEST_PAYLOAD);
        }
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
