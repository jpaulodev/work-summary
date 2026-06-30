import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSourceConfigRepo } from '@work-summary/config-db';
import { authed } from '../plugins/auth-guard.js';

const PutSchema = z.object({
  enabled: z.boolean().optional(),
  token: z.string().min(1).optional(),
  repos: z.array(z.string()).optional(),
  rules: z
    .object({
      authorOfPrUnanswered: z.boolean(),
      mentioned: z.boolean(),
      repliedBeforeThenFollowup: z.boolean(),
      assignee: z.boolean(),
      changesRequested: z.boolean(),
    })
    .optional(),
  filters: z.object({ excludeBots: z.boolean(), botWhitelist: z.array(z.string()) }).optional(),
});

export default function sourcesRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    '/sources',
    authed(() => {
      const repo = createSourceConfigRepo(app.db, app.masterKey);
      const g = repo.getGithub();
      return {
        github: g
          ? {
              enabled: g.enabled,
              repos: g.repos,
              rules: g.rules,
              filters: g.filters,
              hasToken: true,
            }
          : null,
      };
    }),
  );

  app.put(
    '/sources/github',
    authed((req) => {
      const body = PutSchema.parse(req.body);
      createSourceConfigRepo(app.db, app.masterKey).putGithub(body);
      return { ok: true };
    }),
  );
  done();
}
