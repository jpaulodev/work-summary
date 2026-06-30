import type { FastifyInstance } from 'fastify';
import { runScan, loadConfigFromDb } from '@work-summary/cli';
import { createOctokit, GithubSource } from '@work-summary/github-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import { createCommentsRepo, createRunsRepo, createWatermarksRepo } from '@work-summary/storage';
import pino from 'pino';

let running = false;
let lastRunId: number | undefined;

export function scanStatus(): { running: boolean; runId?: number } {
  return lastRunId === undefined ? { running } : { running, runId: lastRunId };
}

export async function triggerScan(app: FastifyInstance): Promise<{ runId: number }> {
  if (running) throw new Error('already-running');
  running = true;
  try {
    // Reuse the same DB-backed config builder the CLI uses so the two stay in sync.
    const config = loadConfigFromDb(app.db, app.masterKey, process.env.GITHUB_LOGIN ?? '');
    const notif = config.notifications.find((n) => n.enabled);
    if (!notif) throw new Error('no enabled notifier');

    const result = await runScan({
      config,
      deps: {
        db: app.db,
        commentsRepo: createCommentsRepo(app.db),
        runsRepo: createRunsRepo(app.db, () => new Date()),
        watermarksRepo: createWatermarksRepo(app.db),
        source: new GithubSource(createOctokit({ token: config.sources.github.token })),
        notifier: new SmtpNotifier({ ...notif.smtp, from: notif.from, to: notif.to }),
        logger: pino({ level: 'info' }),
      },
      dryRun: false,
      now: () => new Date(),
    });

    lastRunId = result.runId;
    return { runId: result.runId };
  } finally {
    running = false;
  }
}
