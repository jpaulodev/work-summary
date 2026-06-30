import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { encryptSecret, decryptSecret } from '@work-summary/auth';
import { JiraClient } from '@work-summary/jira-source';
import type { JiraSiteRow } from '@work-summary/storage';
import { authed } from '../plugins/auth-guard.js';

const SiteSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  token: z.string().min(8),
  // Restrict to the JIRA custom-field id format so it can be safely used in JQL.
  developerFieldId: z
    .string()
    .regex(/^customfield_\d+$/)
    .nullable()
    .optional(),
  enabled: z.boolean().default(true),
});

const ProjectSelection = z.object({
  projects: z.array(
    z.object({
      // JIRA project keys are uppercase alphanumerics; enforced so they cannot
      // break out of the quoted JQL term.
      projectKey: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      projectName: z.string().min(1).max(200),
    }),
  ),
});

interface RedactedSite {
  id: string;
  baseUrl: string;
  email: string;
  developerFieldId: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  hasToken: boolean;
}

function redact(row: JiraSiteRow): RedactedSite {
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    email: row.email,
    developerFieldId: row.developerFieldId,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasToken: true,
  };
}

export default function jiraRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  const decrypt = (site: JiraSiteRow): string =>
    decryptSecret(site.encryptedToken, site.tokenNonce, app.masterKey);

  app.get(
    '/jira/sites',
    authed(() => app.jiraSiteRepo.list().map(redact)),
  );

  app.post(
    '/jira/sites',
    authed(async (req, reply) => {
      const body = SiteSchema.parse(req.body);
      try {
        await new JiraClient({
          baseUrl: body.baseUrl,
          email: body.email,
          token: body.token,
        }).myself();
      } catch (err) {
        return reply.code(400).send({
          error: `connection failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      const enc = encryptSecret(body.token, app.masterKey);
      const row = app.jiraSiteRepo.insert({
        id: randomUUID(),
        baseUrl: body.baseUrl,
        email: body.email,
        encryptedToken: enc.ciphertext,
        tokenNonce: enc.nonce,
        developerFieldId: body.developerFieldId ?? null,
        enabled: body.enabled,
      });
      return reply.code(201).send(redact(row));
    }),
  );

  app.put(
    '/jira/sites/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      if (!app.jiraSiteRepo.get(id)) return reply.code(404).send({ error: 'not found' });
      const body = SiteSchema.partial().parse(req.body);
      const patch: Parameters<typeof app.jiraSiteRepo.update>[1] = {
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.developerFieldId !== undefined ? { developerFieldId: body.developerFieldId } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      };
      if (body.token) {
        const enc = encryptSecret(body.token, app.masterKey);
        patch.encryptedToken = enc.ciphertext;
        patch.tokenNonce = enc.nonce;
      }
      return redact(app.jiraSiteRepo.update(id, patch));
    }),
  );

  app.delete(
    '/jira/sites/:id',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      app.jiraSiteRepo.delete(id);
      return reply.code(204).send();
    }),
  );

  app.get(
    '/jira/sites/:id/projects',
    authed((req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return app.jiraProjectRepo.listBySite(id);
    }),
  );

  app.put(
    '/jira/sites/:id/projects',
    authed((req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      if (!app.jiraSiteRepo.get(id)) return reply.code(404).send({ error: 'not found' });
      const body = ProjectSelection.parse(req.body);
      return app.jiraProjectRepo.replaceForSite(id, body.projects);
    }),
  );

  app.get(
    '/jira/sites/:id/projects/discover',
    authed(async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const site = app.jiraSiteRepo.get(id);
      if (!site) return reply.code(404).send({ error: 'not found' });
      const client = new JiraClient({
        baseUrl: site.baseUrl,
        email: site.email,
        token: decrypt(site),
      });
      return await client.listProjects();
    }),
  );

  app.get(
    '/jira/sites/:id/fields/discover',
    authed(async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const site = app.jiraSiteRepo.get(id);
      if (!site) return reply.code(404).send({ error: 'not found' });
      const client = new JiraClient({
        baseUrl: site.baseUrl,
        email: site.email,
        token: decrypt(site),
      });
      const fields = await client.listFields();
      return fields.filter((f) => f.custom && /develop/i.test(f.name));
    }),
  );
  done();
}
