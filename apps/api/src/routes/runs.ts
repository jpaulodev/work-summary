import type { FastifyInstance } from 'fastify';
import { authed } from '../plugins/auth-guard.js';

export default function runsRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    '/runs',
    authed((req) => {
      const rows = app.db
        .prepare(
          `SELECT id, started_at AS startedAt, finished_at AS finishedAt, status,
             comments_found AS commentsFound, comments_notified AS commentsNotified,
             error_message AS errorMessage, source_stats AS sourceStats
           FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
        )
        .all(req.userId) as Array<Record<string, unknown>>;
      return { items: rows };
    }),
  );
  done();
}
