import type { FastifyInstance } from 'fastify';
import { authed } from '../plugins/auth-guard.js';
import { triggerScan, scanStatus } from '../scan-runner.js';

export default function scanRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.post(
    '/scan',
    authed(async (_req, reply) => {
      try {
        const { runId } = await triggerScan(app);
        return { runId };
      } catch (err) {
        if (err instanceof Error && err.message === 'already-running') {
          return reply.code(409).send({ error: 'already-running' });
        }
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  );

  app.get(
    '/scan/status',
    authed(() => scanStatus()),
  );
  done();
}
