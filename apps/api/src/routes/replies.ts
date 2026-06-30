import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createOctokit, postGithubReply } from '@work-summary/github-source';
import { JiraClient, postJiraReply } from '@work-summary/jira-source';
import { createOAuthConnectionService } from '@work-summary/config-db';
import { CommentReplyRepository } from '@work-summary/storage';
import { authed } from '../plugins/auth-guard.js';
import { getValidJiraAccess } from '../jira-access.js';

const BodySchema = z.object({ body: z.string().min(1).max(10000) });

interface CommentRow {
  id: string;
  source: string;
  repo: string;
  issue_key: string | null;
  comment_url: string | null;
}

function hasScopeError(err: unknown): boolean {
  return (err as { code?: string }).code === 'token-write-scope';
}

export default function repliesRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.post(
    '/comments/:id/reply',
    authed(async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { body } = BodySchema.parse(req.body);
      const comment = app.db
        .prepare(
          'SELECT id, source, repo, issue_key, comment_url FROM notified_comments WHERE id = ?',
        )
        .get(id) as CommentRow | undefined;
      if (!comment) return reply.code(404).send({ error: 'not found' });

      let result: { id: string | number; url: string };
      try {
        if (comment.source === 'github') {
          if (!comment.comment_url) {
            return reply.code(412).send({
              error: 'no-comment-url',
              message:
                'This comment was collected before reply support was added; re-scan to enable replying.',
            });
          }
          const tokens = createOAuthConnectionService(app.db, app.masterKey).getTokens(1, 'github');
          if (!tokens) {
            return reply
              .code(412)
              .send({ error: 'no-source', message: 'GitHub is not connected.' });
          }
          const r = await postGithubReply({
            octokit: createOctokit({ token: tokens.accessToken }),
            commentUrl: comment.comment_url,
            body,
          });
          result = { id: r.id, url: r.url };
        } else if (comment.source === 'jira') {
          if (!comment.issue_key) {
            return reply
              .code(412)
              .send({ error: 'no-issue-key', message: 'Missing JIRA issue key.' });
          }
          const jiraAccess = await getValidJiraAccess(app, 1);
          if (!jiraAccess) {
            return reply.code(412).send({ error: 'no-source', message: 'JIRA is not connected.' });
          }
          const client = new JiraClient({
            accessToken: jiraAccess.accessToken,
            cloudId: jiraAccess.cloudId,
          });
          const r = await postJiraReply({ client, issueKey: comment.issue_key, body });
          result = { id: r.id, url: r.self };
        } else {
          return reply.code(400).send({ error: `unsupported source: ${comment.source}` });
        }
      } catch (err) {
        // A failed reply must NOT change the comment status.
        if (hasScopeError(err)) {
          return reply
            .code(400)
            .send({ error: 'token-write-scope', message: 'Token may lack write scope' });
        }
        return reply
          .code(502)
          .send({ error: 'upstream', message: err instanceof Error ? err.message : String(err) });
      }

      const row = new CommentReplyRepository(app.db).insert({
        commentId: id,
        body,
        sentAt: app.now().toISOString(),
        source: comment.source,
        sourceResponseId: String(result.id),
        sourceUrl: result.url,
      });
      app.db
        .prepare(
          `INSERT INTO comment_status (comment_id, status, snoozed_until, note, updated_at)
           VALUES (?, 'addressed', NULL, NULL, ?)
           ON CONFLICT(comment_id) DO UPDATE SET status='addressed', updated_at=excluded.updated_at`,
        )
        .run(id, app.now().toISOString());
      return { reply: row, status: 'addressed' };
    }),
  );

  app.get(
    '/comments/:id/replies',
    authed((req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      return new CommentReplyRepository(app.db).listByComment(id);
    }),
  );
  done();
}
