import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { verifySessionId } from '@work-summary/auth';
import type { SqliteDatabase } from '@work-summary/storage';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: number;
  }
}

export interface AuthGuardOptions {
  sessionSecret: Buffer;
}

function plugin(app: FastifyInstance, opts: AuthGuardOptions, done: () => void): void {
  app.decorateRequest('userId', undefined);
  app.addHook('preHandler', (req: FastifyRequest, _reply: FastifyReply, next: () => void) => {
    const cookie = req.cookies['ws_session'];
    if (!cookie) return next();
    const id = verifySessionId(cookie, opts.sessionSecret);
    if (!id) return next();
    const server = req.server as FastifyInstance & {
      db: SqliteDatabase;
      now: () => Date;
    };
    const row = server.db
      .prepare('SELECT user_id, expires_at FROM app_session WHERE id = ?')
      .get(id) as { user_id: number; expires_at: string } | undefined;
    if (!row) return next();
    if (new Date(row.expires_at).getTime() < server.now().getTime()) return next();
    req.userId = row.user_id;
    return next();
  });
  done();
}

export default fp(plugin);

/**
 * Wrap a route handler so it rejects unauthenticated requests with 401 before
 * running. Using a wrapper (rather than a child preHandler hook) guarantees it
 * runs after the global session-resolving preHandler regardless of scope order.
 */
export function authed(handler: RouteHandlerMethod): RouteHandlerMethod {
  return function authedHandler(this: FastifyInstance, req, reply) {
    if (!req.userId) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return handler.call(this, req, reply);
  };
}

/** Like authed(), but additionally requires the current user to be an admin. */
export function adminOnly(handler: RouteHandlerMethod): RouteHandlerMethod {
  return authed(function adminHandler(this: FastifyInstance, req, reply) {
    const server = req.server as FastifyInstance & { db: SqliteDatabase };
    const row = server.db.prepare('SELECT role FROM app_user WHERE id = ?').get(req.userId) as
      { role: string } | undefined;
    if (row?.role !== 'admin') {
      return reply.code(403).send({ error: 'admin-only' });
    }
    return handler.call(this, req, reply);
  });
}
