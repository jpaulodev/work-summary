import type { FastifyInstance } from 'fastify';
import { runScan, type Config } from '@work-summary/cli';
import { createOctokit, GithubSource, type Source } from '@work-summary/github-source';
import { JiraSource } from '@work-summary/jira-source';
import {
  createSourceConfigRepo,
  createNotifierConfigRepo,
  createOAuthConnectionService,
} from '@work-summary/config-db';
import { getValidJiraAccess, type JiraAccess } from './jira-access.js';
import {
  createCommentsRepo,
  createRunsRepo,
  createWatermarksRepo,
  JiraSiteRepository,
  JiraProjectRepository,
} from '@work-summary/storage';
import type { PendingComment } from '@work-summary/core';
import pino from 'pino';
import { buildNotifier, buildCompositeNotifier } from './notifier-factory.js';

/**
 * A Source that fans out to GitHub and (if any sites are configured) JIRA,
 * concatenating their PendingComment results so they share the dedup/notify path.
 */
function buildCompositeSource(
  app: FastifyInstance,
  userId: number,
  githubSource: GithubSource | null,
  jiraAccess: JiraAccess | null,
  since: Date,
  lookbackDays: number,
  report: (patch: Partial<ScanProgress>) => void,
): Source {
  const siteRepo = new JiraSiteRepository(app.db, userId);
  const projectRepo = new JiraProjectRepository(app.db, userId);
  const sites = siteRepo.list();
  return {
    id: 'github',
    fetchPendingComments: async (opts): Promise<PendingComment[]> => {
      // GitHub is skipped entirely when no OAuth connection exists.
      report({ phase: 'github', reposTotal: opts.repos.length, reposDone: 0 });
      const github = githubSource
        ? await githubSource.fetchPendingComments({
            ...opts,
            onRepoDone: (done, total) => report({ reposDone: done, reposTotal: total }),
          })
        : [];
      report({ commentsFound: github.length });
      if (!jiraAccess || sites.length === 0) {
        report({ phase: 'saving' });
        return github;
      }
      // JIRA is best-effort: a failing site/token must not discard the GitHub
      // results already fetched or fail the whole scan run.
      report({ phase: 'jira' });
      try {
        const jira = new JiraSource({
          sites,
          projects: sites.flatMap((s) => projectRepo.listBySite(s.id)),
          accessToken: jiraAccess.accessToken,
          cloudId: jiraAccess.cloudId,
          since,
          lookbackDays,
          logger: { error: (msg, err) => process.stderr.write(`${msg}: ${String(err)}\n`) },
        });
        const jiraComments = await jira.fetchPendingComments();
        report({ phase: 'saving', commentsFound: github.length + jiraComments.length });
        return [...github, ...jiraComments];
      } catch (err) {
        process.stderr.write(`[scan] JIRA fetch failed, using GitHub only: ${String(err)}\n`);
        report({ phase: 'saving' });
        return github;
      }
    },
  };
}

/** Coarse, live progress for an in-flight scan, surfaced via GET /scan/status. */
export interface ScanProgress {
  phase: 'preparing' | 'github' | 'jira' | 'saving';
  reposDone: number;
  reposTotal: number;
  commentsFound: number;
}

// Per-user single-flight: one in-flight scan per user, last run id per user.
const runningUsers = new Set<number>();
const lastRunIdByUser = new Map<number, number>();
const progressByUser = new Map<number, ScanProgress>();

export function scanStatus(userId: number): {
  running: boolean;
  runId?: number;
  progress?: ScanProgress;
} {
  const runId = lastRunIdByUser.get(userId);
  const progress = progressByUser.get(userId);
  return {
    running: runningUsers.has(userId),
    ...(runId === undefined ? {} : { runId }),
    ...(progress ? { progress } : {}),
  };
}

export interface TriggerScanOptions {
  userId: number;
  triggeredBy?: string;
  reposFilter?: string[] | null;
}

export async function triggerScan(
  app: FastifyInstance,
  opts: TriggerScanOptions,
): Promise<{ runId: number }> {
  const userId = opts.userId;
  if (runningUsers.has(userId)) throw new Error('already-running');
  runningUsers.add(userId);
  const report = (patch: Partial<ScanProgress>): void => {
    const cur = progressByUser.get(userId) ?? {
      phase: 'preparing',
      reposDone: 0,
      reposTotal: 0,
      commentsFound: 0,
    };
    progressByUser.set(userId, { ...cur, ...patch });
  };
  report({});
  try {
    const logger = pino({ level: 'info' });
    const ghCfg = createSourceConfigRepo(app.db, userId).getGithub();
    const ghTokens = createOAuthConnectionService(app.db, app.masterKey).getTokens(
      userId,
      'github',
    );
    const jiraAccess = await getValidJiraAccess(app, userId);
    if (!ghTokens && !jiraAccess) {
      throw new Error('no source connected: connect GitHub or JIRA');
    }

    // Build a notifier per enabled config (smtp/slack/teams) and fan out to all.
    // Notifiers are OPTIONAL: with none configured the composite is a no-op, so
    // the scan still fetches, de-dups, and records comments to the dashboard —
    // it just doesn't send a digest.
    const notifRepo = createNotifierConfigRepo(app.db, app.masterKey, userId);
    const fulls = notifRepo
      .list()
      .filter((n) => n.enabled)
      .map((n) => notifRepo.get(n.id))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    const composite = buildCompositeNotifier(
      fulls.map((f) => ({ id: f.id, notifier: buildNotifier(f) })),
      logger,
    );
    const subjectTemplate =
      fulls.find((f) => f.type === 'smtp')?.subjectTemplate ??
      '[work-summary] {{count}} - {{date}}';

    const DEFAULT_RULES = {
      authorOfPrUnanswered: true,
      mentioned: true,
      repliedBeforeThenFollowup: true,
      assignee: true,
      changesRequested: true,
    };
    const DEFAULT_FILTERS = { excludeBots: true, botWhitelist: [] as string[] };
    // Repos/rules/filters only matter when GitHub is connected; otherwise the
    // GitHub side contributes nothing and JIRA carries the scan.
    const ghRepos = ghTokens ? (ghCfg?.repos ?? []) : [];
    const repos = opts.reposFilter && opts.reposFilter.length > 0 ? opts.reposFilter : ghRepos;
    const config: Config = {
      user: { githubLogin: ghTokens?.accountLogin ?? '' },
      sources: {
        github: {
          token: ghTokens?.accessToken ?? '',
          repos,
          rules: ghCfg?.rules ?? DEFAULT_RULES,
          filters: ghCfg?.filters ?? DEFAULT_FILTERS,
        },
      },
      scan: { lookbackDays: 7, concurrency: 3 },
      // A single synthetic enabled entry carries the subject template; the actual
      // delivery goes to the composite notifier in deps below.
      notifications: [
        {
          id: 'all',
          type: 'smtp',
          enabled: true,
          smtp: { host: '', port: 587, secure: false, user: '', pass: '' },
          from: '',
          to: '',
          subjectTemplate,
        },
      ],
      logging: { level: 'info', file: '/tmp/api-scan.log' },
    };

    const githubSource = ghTokens
      ? new GithubSource(createOctokit({ token: ghTokens.accessToken }))
      : null;
    const since = new Date(Date.now() - config.scan.lookbackDays * 24 * 60 * 60 * 1000);
    const result = await runScan({
      config,
      deps: {
        db: app.db,
        commentsRepo: createCommentsRepo(app.db, userId),
        runsRepo: createRunsRepo(app.db, userId, () => new Date()),
        watermarksRepo: createWatermarksRepo(app.db, userId),
        source: buildCompositeSource(
          app,
          userId,
          githubSource,
          jiraAccess,
          since,
          config.scan.lookbackDays,
          report,
        ),
        notifier: composite,
        logger,
      },
      dryRun: false,
      now: () => new Date(),
      triggeredBy: opts.triggeredBy ?? 'manual',
    });

    lastRunIdByUser.set(userId, result.runId);
    return { runId: result.runId };
  } finally {
    runningUsers.delete(userId);
    progressByUser.delete(userId);
  }
}
