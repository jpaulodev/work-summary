import type { FastifyInstance } from 'fastify';
import { runScan, loadConfigFromDb } from '@work-summary/cli';
import { createOctokit, GithubSource, type Source } from '@work-summary/github-source';
import { JiraSource } from '@work-summary/jira-source';
import { SmtpNotifier } from '@work-summary/notifiers';
import { decryptSecret } from '@work-summary/auth';
import {
  createCommentsRepo,
  createRunsRepo,
  createWatermarksRepo,
  JiraSiteRepository,
  JiraProjectRepository,
} from '@work-summary/storage';
import type { PendingComment } from '@work-summary/core';
import pino from 'pino';

/**
 * A Source that fans out to GitHub and (if any sites are configured) JIRA,
 * concatenating their PendingComment results so they share the dedup/notify path.
 */
function buildCompositeSource(
  app: FastifyInstance,
  githubSource: GithubSource,
  since: Date,
): Source {
  const siteRepo = new JiraSiteRepository(app.db);
  const projectRepo = new JiraProjectRepository(app.db);
  const sites = siteRepo.list();
  return {
    id: 'github',
    fetchPendingComments: async (opts): Promise<PendingComment[]> => {
      const github = await githubSource.fetchPendingComments(opts);
      if (sites.length === 0) return github;
      const jira = new JiraSource({
        sites,
        projects: sites.flatMap((s) => projectRepo.listBySite(s.id)),
        decryptToken: (enc, nonce) => decryptSecret(enc, nonce, app.masterKey),
        since,
      });
      const jiraComments = await jira.fetchPendingComments();
      return [...github, ...jiraComments];
    },
  };
}

let running = false;
let lastRunId: number | undefined;

export function scanStatus(): { running: boolean; runId?: number } {
  return lastRunId === undefined ? { running } : { running, runId: lastRunId };
}

export interface TriggerScanOptions {
  triggeredBy?: string;
  reposFilter?: string[] | null;
}

export async function triggerScan(
  app: FastifyInstance,
  opts: TriggerScanOptions = {},
): Promise<{ runId: number }> {
  if (running) throw new Error('already-running');
  running = true;
  try {
    // Reuse the same DB-backed config builder the CLI uses so the two stay in sync.
    const config = loadConfigFromDb(app.db, app.masterKey, process.env.GITHUB_LOGIN ?? '');
    if (opts.reposFilter && opts.reposFilter.length > 0) {
      config.sources.github.repos = opts.reposFilter;
    }
    const notif = config.notifications.find((n) => n.enabled);
    if (!notif) throw new Error('no enabled notifier');

    const githubSource = new GithubSource(createOctokit({ token: config.sources.github.token }));
    const since = new Date(Date.now() - config.scan.lookbackDays * 24 * 60 * 60 * 1000);
    const result = await runScan({
      config,
      deps: {
        db: app.db,
        commentsRepo: createCommentsRepo(app.db),
        runsRepo: createRunsRepo(app.db, () => new Date()),
        watermarksRepo: createWatermarksRepo(app.db),
        source: buildCompositeSource(app, githubSource, since),
        notifier: new SmtpNotifier({ ...notif.smtp, from: notif.from, to: notif.to }),
        logger: pino({ level: 'info' }),
      },
      dryRun: false,
      now: () => new Date(),
      triggeredBy: opts.triggeredBy ?? 'manual',
    });

    lastRunId = result.runId;
    return { runId: result.runId };
  } finally {
    running = false;
  }
}
