import type { FastifyInstance } from 'fastify';
import { runScan } from '@work-summary/cli';
import { createOctokit, GithubSource } from '@work-summary/github-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import { createCommentsRepo, createRunsRepo, createWatermarksRepo } from '@work-summary/storage';
import { createSourceConfigRepo, createNotifierConfigRepo } from '@work-summary/config-db';
import pino from 'pino';

let running = false;
let lastRunId: number | undefined;

export function scanStatus(): { running: boolean; runId?: number } {
  return lastRunId === undefined ? { running } : { running, runId: lastRunId };
}

function nextRunId(app: FastifyInstance): number {
  const row = app.db.prepare('SELECT MAX(id) AS maxId FROM runs').get() as { maxId: number | null };
  return row.maxId ?? 0;
}

export async function triggerScan(app: FastifyInstance): Promise<{ runId: number }> {
  if (running) throw new Error('already-running');
  running = true;
  try {
    const src = createSourceConfigRepo(app.db, app.masterKey);
    const notif = createNotifierConfigRepo(app.db, app.masterKey);
    const gh = src.getGithub();
    if (!gh) throw new Error('github not configured');
    const enabled = notif.list().find((x) => x.enabled);
    if (!enabled) throw new Error('no enabled notifier');
    const full = notif.get(enabled.id);
    if (!full) throw new Error('notifier missing');

    const config = {
      user: { githubLogin: process.env.GITHUB_LOGIN ?? '' },
      sources: {
        github: { token: gh.token, repos: gh.repos, rules: gh.rules, filters: gh.filters },
      },
      scan: { lookbackDays: 7, concurrency: 3 },
      notifications: [
        {
          id: full.id,
          type: 'smtp' as const,
          enabled: true,
          smtp: {
            host: full.host,
            port: full.port,
            secure: full.secure,
            user: full.user,
            pass: full.pass,
          },
          from: full.from,
          to: full.to,
          subjectTemplate: full.subjectTemplate,
        },
      ],
      logging: { level: 'info' as const, file: '/tmp/api-scan.log' },
    };

    await runScan({
      config,
      deps: {
        db: app.db,
        commentsRepo: createCommentsRepo(app.db),
        runsRepo: createRunsRepo(app.db, () => new Date()),
        watermarksRepo: createWatermarksRepo(app.db),
        source: new GithubSource(createOctokit({ token: gh.token })),
        notifier: new SmtpNotifier({
          host: full.host,
          port: full.port,
          secure: full.secure,
          user: full.user,
          pass: full.pass,
          from: full.from,
          to: full.to,
        }),
        logger: pino({ level: 'info' }),
      },
      dryRun: false,
      now: () => new Date(),
    });

    lastRunId = nextRunId(app);
    return { runId: lastRunId };
  } finally {
    running = false;
  }
}
