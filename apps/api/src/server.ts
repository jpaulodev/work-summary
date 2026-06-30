import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import authGuard from './plugins/auth-guard.js';
import authRoutes from './routes/auth.js';
import bootstrapRoutes from './routes/bootstrap.js';
import sourcesRoutes from './routes/sources.js';
import notifiersRoutes from './routes/notifiers.js';
import commentsRoutes from './routes/comments.js';
import runsRoutes from './routes/runs.js';
import scanRoutes from './routes/scan.js';
import type { SqliteDatabase } from '@work-summary/storage';

export interface ServerDeps {
  db: SqliteDatabase;
  masterKey: Buffer;
  sessionSecret: Buffer;
  now: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: SqliteDatabase;
    masterKey: Buffer;
    sessionSecret: Buffer;
    now: () => Date;
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    const message = err instanceof Error ? err.message : 'internal';
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number') {
      return reply.code(statusCode).send({ error: message });
    }
    return reply.code(500).send({ error: 'internal' });
  });

  app.decorate('db', deps.db);
  app.decorate('masterKey', deps.masterKey);
  app.decorate('sessionSecret', deps.sessionSecret);
  app.decorate('now', deps.now);

  await app.register(cookie);
  await app.register(authGuard, { sessionSecret: deps.sessionSecret });

  await app.register(bootstrapRoutes, { prefix: '/api/auth' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(sourcesRoutes, { prefix: '/api' });
  await app.register(notifiersRoutes, { prefix: '/api' });
  await app.register(commentsRoutes, { prefix: '/api' });
  await app.register(runsRoutes, { prefix: '/api' });
  await app.register(scanRoutes, { prefix: '/api' });

  if (process.env.NODE_ENV === 'production') {
    const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
    if (existsSync(webDist)) {
      await app.register(fastifyStatic, { root: webDist, prefix: '/' });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
        return reply.sendFile('index.html');
      });
    }
  }

  return app;
}
