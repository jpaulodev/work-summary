import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSourceConfigRepo, createOAuthConnectionService } from '@work-summary/config-db';
import { createOctokit, listAccessibleRepos } from '@work-summary/github-source';
import { authed } from '../plugins/auth-guard.js';

const PutSchema = z.object({
  enabled: z.boolean().optional(),
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
    authed((req) => {
      const userId = req.userId as number;
      const g = createSourceConfigRepo(app.db, userId).getGithub();
      const conn = createOAuthConnectionService(app.db, app.masterKey).getView(userId, 'github');
      return {
        github: {
          enabled: g?.enabled ?? true,
          repos: g?.repos ?? [],
          rules: g?.rules ?? null,
          filters: g?.filters ?? null,
          connection: conn
            ? { accountLogin: conn.accountLogin, connectedAt: conn.connectedAt }
            : null,
        },
      };
    }),
  );

  app.put(
    '/sources/github',
    authed((req) => {
      const body = PutSchema.parse(req.body);
      createSourceConfigRepo(app.db, req.userId as number).putGithub(body);
      return { ok: true };
    }),
  );

  // Discover the repositories the connected GitHub account can access, so the
  // UI can offer a searchable picker instead of manual owner/repo entry.
  app.get(
    '/sources/github/repos',
    authed(async (req, reply) => {
      const tokens = createOAuthConnectionService(app.db, app.masterKey).getTokens(
        req.userId as number,
        'github',
      );
      if (!tokens) return reply.code(412).send({ error: 'github-not-connected' });
      try {
        const repos = await listAccessibleRepos(createOctokit({ token: tokens.accessToken }));
        return { repos };
      } catch (err) {
        return reply
          .code(502)
          .send({ error: 'github', message: err instanceof Error ? err.message : String(err) });
      }
    }),
  );
  done();
}
