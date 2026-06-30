import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JiraClient } from '@work-summary/jira-source';
import { createOAuthConnectionService } from '@work-summary/config-db';
import type { JiraSiteRow } from '@work-summary/storage';
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
  function ensureSite(): JiraSiteRow | null {
    const conn = createOAuthConnectionService(app.db, app.masterKey).getView(1, 'jira');
    if (!conn || !conn.cloudId) return null;
    const id = conn.cloudId;
    for (const s of app.jiraSiteRepo.list()) {
      if (s.id !== id) app.jiraSiteRepo.delete(s.id);
    }
    const existing = app.jiraSiteRepo.get(id);
    if (!existing) {
      return app.jiraSiteRepo.insert({
        id,
        baseUrl: conn.siteUrl ?? '',
        cloudId: conn.cloudId,
        developerFieldId: null,
        enabled: true,
      });
    }
    if (conn.siteUrl && existing.baseUrl !== conn.siteUrl) {
      return app.jiraSiteRepo.update(id, { baseUrl: conn.siteUrl });
    }
    return existing;
  }

  app.get(
    '/jira/site',
    authed(() => {
      const site = ensureSite();
      return site ? { connected: true, site: view(site) } : { connected: false };
    }),
  );

  app.put(
    '/jira/site',
    authed((req, reply) => {
      const site = ensureSite();
      if (!site) return reply.code(412).send({ error: 'jira-not-connected' });
      const body = SiteSettings.parse(req.body);
      const patch: Parameters<typeof app.jiraSiteRepo.update>[1] = {
        ...(body.developerFieldId !== undefined ? { developerFieldId: body.developerFieldId } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      };
      return view(app.jiraSiteRepo.update(site.id, patch));
    }),
  );

  app.delete(
    '/jira/site',
    authed((_req, reply) => {
      for (const s of app.jiraSiteRepo.list()) app.jiraSiteRepo.delete(s.id);
      createOAuthConnectionService(app.db, app.masterKey).delete(1, 'jira');
      return reply.code(204).send();
    }),
  );

  app.get(
    '/jira/site/projects',
    authed(() => {
      const site = ensureSite();
      return site ? app.jiraProjectRepo.listBySite(site.id) : [];
    }),
  );

  app.put(
    '/jira/site/projects',
    authed((req, reply) => {
      const site = ensureSite();
      if (!site) return reply.code(412).send({ error: 'jira-not-connected' });
      const body = ProjectSelection.parse(req.body);
      return app.jiraProjectRepo.replaceForSite(site.id, body.projects);
    }),
  );

  app.get(
    '/jira/site/projects/discover',
    authed(async (_req, reply) => {
      const access = await getValidJiraAccess(app, 1);
      if (!access) return reply.code(412).send({ error: 'jira-not-connected' });
      const client = new JiraClient({ accessToken: access.accessToken, cloudId: access.cloudId });
      return await client.listProjects();
    }),
  );

  app.get(
    '/jira/site/fields/discover',
    authed(async (_req, reply) => {
      const access = await getValidJiraAccess(app, 1);
      if (!access) return reply.code(412).send({ error: 'jira-not-connected' });
      const client = new JiraClient({ accessToken: access.accessToken, cloudId: access.cloudId });
      const fields = await client.listFields();
      return fields.filter((f) => f.custom && /develop/i.test(f.name));
    }),
  );
  done();
}
