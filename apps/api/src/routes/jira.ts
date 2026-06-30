import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JiraClient } from '@work-summary/jira-source';
import { createOAuthConnectionService } from '@work-summary/config-db';
import { JiraSiteRepository, JiraProjectRepository, type JiraSiteRow } from '@work-summary/storage';
import { authed } from '../plugins/auth-guard.js';
import { getValidJiraAccess } from '../jira-access.js';

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

const SiteSettings = z.object({
  developerFieldId: z
    .string()
    .regex(/^customfield_\d+$/)
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
});

interface SiteView {
  id: string;
  baseUrl: string;
  developerFieldId: string | null;
  enabled: boolean;
}

function view(row: JiraSiteRow): SiteView {
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    developerFieldId: row.developerFieldId,
    enabled: row.enabled,
  };
}

export default function jiraRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  /**
   * With OAuth 3LO there is exactly one JIRA connection per user. Mirror it into
   * a single jira_site row (keyed by cloud id) that anchors project selection and
   * the developer-field setting, removing any stale rows from earlier installs.
   */
  function ensureSite(userId: number): JiraSiteRow | null {
    const siteRepo = new JiraSiteRepository(app.db, userId);
    const conn = createOAuthConnectionService(app.db, app.masterKey, app.now).getView(
      userId,
      'jira',
    );
    if (!conn || !conn.cloudId) return null;
    const id = conn.cloudId;
    for (const s of siteRepo.list()) {
      if (s.id !== id) siteRepo.delete(s.id);
    }
    const existing = siteRepo.get(id);
    if (!existing) {
      return siteRepo.insert({
        id,
        baseUrl: conn.siteUrl ?? '',
        cloudId: conn.cloudId,
        developerFieldId: null,
        enabled: true,
      });
    }
    if (conn.siteUrl && existing.baseUrl !== conn.siteUrl) {
      return siteRepo.update(id, { baseUrl: conn.siteUrl });
    }
    return existing;
  }

  app.get(
    '/jira/site',
    authed((req) => {
      const site = ensureSite(req.userId as number);
      return site ? { connected: true, site: view(site) } : { connected: false };
    }),
  );

  app.put(
    '/jira/site',
    authed((req, reply) => {
      const userId = req.userId as number;
      const site = ensureSite(userId);
      if (!site) return reply.code(412).send({ error: 'jira-not-connected' });
      const body = SiteSettings.parse(req.body);
      const siteRepo = new JiraSiteRepository(app.db, userId);
      const patch: Parameters<typeof siteRepo.update>[1] = {
        ...(body.developerFieldId !== undefined ? { developerFieldId: body.developerFieldId } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      };
      return view(siteRepo.update(site.id, patch));
    }),
  );

  app.delete(
    '/jira/site',
    authed((req, reply) => {
      const userId = req.userId as number;
      const siteRepo = new JiraSiteRepository(app.db, userId);
      for (const s of siteRepo.list()) siteRepo.delete(s.id);
      createOAuthConnectionService(app.db, app.masterKey).delete(userId, 'jira');
      return reply.code(204).send();
    }),
  );

  app.get(
    '/jira/site/projects',
    authed((req) => {
      const userId = req.userId as number;
      const site = ensureSite(userId);
      return site ? new JiraProjectRepository(app.db, userId).listBySite(site.id) : [];
    }),
  );

  app.put(
    '/jira/site/projects',
    authed((req, reply) => {
      const userId = req.userId as number;
      const site = ensureSite(userId);
      if (!site) return reply.code(412).send({ error: 'jira-not-connected' });
      const body = ProjectSelection.parse(req.body);
      return new JiraProjectRepository(app.db, userId).replaceForSite(site.id, body.projects);
    }),
  );

  app.get(
    '/jira/site/projects/discover',
    authed(async (req, reply) => {
      const access = await getValidJiraAccess(app, req.userId as number);
      if (!access) return reply.code(412).send({ error: 'jira-not-connected' });
      const client = new JiraClient({ accessToken: access.accessToken, cloudId: access.cloudId });
      return await client.listProjects();
    }),
  );

  app.get(
    '/jira/site/fields/discover',
    authed(async (req, reply) => {
      const access = await getValidJiraAccess(app, req.userId as number);
      if (!access) return reply.code(412).send({ error: 'jira-not-connected' });
      const client = new JiraClient({ accessToken: access.accessToken, cloudId: access.cloudId });
      const fields = await client.listFields();
      return fields.filter((f) => f.custom && /develop/i.test(f.name));
    }),
  );
  done();
}
