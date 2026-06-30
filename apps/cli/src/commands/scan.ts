import type { Logger } from 'pino';
import type { PendingComment } from '@work-summary/core';
import type { Source } from '@work-summary/github-source';
import type { Notifier, NotificationPayload } from '@work-summary/notifiers';
import type { CommentsRepo, RunsRepo, WatermarksRepo, SqliteDatabase } from '@work-summary/storage';
import type { Config } from '../config.js';
import { EXIT } from '../exit-codes.js';

export interface ScanDeps {
  db: SqliteDatabase;
  commentsRepo: CommentsRepo;
  runsRepo: RunsRepo;
  watermarksRepo: WatermarksRepo;
  source: Source;
  notifier: Notifier;
  logger: Logger;
}

function renderSubject(template: string, count: number, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return template
    .replace(/\{\{count\}\}/g, String(count))
    .replace(/\{\{date\}\}/g, `${yyyy}-${mm}-${dd}`);
}

function isSmtpError(err: unknown): boolean {
  return err instanceof Error && err.name === 'SmtpError';
}

export interface RunScanArgs {
  config: Config;
  deps: ScanDeps;
  dryRun: boolean;
  now: () => Date;
}

export async function runScan(
  args: RunScanArgs,
): Promise<{ exitCode: number; newComments: number; runId: number }> {
  const { config, deps, dryRun, now } = args;
  const runId = deps.runsRepo.startRun();
  const log = deps.logger.child({ runId });

  const lookbackMs = config.scan.lookbackDays * 24 * 60 * 60 * 1000;
  const defaultSince = new Date(now().getTime() - lookbackMs).toISOString();
  const sinceByRepo: Record<string, string | undefined> = {};
  for (const repo of config.sources.github.repos) {
    const wm = deps.watermarksRepo.get('github', repo);
    if (wm) sinceByRepo[repo] = wm;
  }

  let fetched: PendingComment[];
  try {
    fetched = await deps.source.fetchPendingComments({
      repos: config.sources.github.repos,
      userLogin: config.user.githubLogin,
      sinceByRepo,
      defaultSince,
      rules: config.sources.github.rules,
      filters: config.sources.github.filters,
      concurrency: config.scan.concurrency,
    });
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'failed', {
      commentsFound: 0,
      commentsNotified: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    log.error({ err }, 'Source fetch failed');
    return { exitCode: EXIT.UNEXPECTED, newComments: 0, runId };
  }

  const newComments = deps.commentsRepo.filterUnnotified(fetched);

  if (newComments.length === 0) {
    deps.runsRepo.finishRun(runId, 'success', {
      commentsFound: fetched.length,
      commentsNotified: 0,
    });
    for (const repo of config.sources.github.repos)
      deps.watermarksRepo.set('github', repo, now().toISOString());
    log.info({ found: fetched.length }, 'No new comments');
    return { exitCode: EXIT.OK, newComments: 0, runId };
  }

  const notif = config.notifications.find((n) => n.enabled);
  if (!notif) {
    deps.runsRepo.finishRun(runId, 'failed', {
      commentsFound: fetched.length,
      commentsNotified: 0,
      errorMessage: 'No enabled notifier',
    });
    return { exitCode: EXIT.CONFIG, newComments: newComments.length, runId };
  }

  const payload: NotificationPayload = {
    subject: renderSubject(notif.subjectTemplate, newComments.length, now()),
    comments: newComments,
    generatedAt: now().toISOString(),
  };

  if (dryRun) {
    deps.runsRepo.finishRun(runId, 'success', {
      commentsFound: fetched.length,
      commentsNotified: 0,
    });
    log.info({ would: newComments.length }, 'Dry-run');
    return { exitCode: EXIT.DRY_RUN_WOULD_SEND, newComments: newComments.length, runId };
  }

  try {
    await deps.notifier.send(payload);
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'failed', {
      commentsFound: fetched.length,
      commentsNotified: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    log.error({ err }, 'Notifier send failed');
    return {
      exitCode: isSmtpError(err) ? EXIT.SMTP : EXIT.UNEXPECTED,
      newComments: newComments.length,
      runId,
    };
  }

  try {
    deps.commentsRepo.markAsNotified(newComments, now().toISOString());
    for (const repo of config.sources.github.repos)
      deps.watermarksRepo.set('github', repo, now().toISOString());
  } catch (err) {
    deps.runsRepo.finishRun(runId, 'partial', {
      commentsFound: fetched.length,
      commentsNotified: newComments.length,
      errorMessage: 'Storage failure after send',
    });
    log.error({ err }, 'Storage write failed after send');
    return { exitCode: EXIT.STORAGE, newComments: newComments.length, runId };
  }

  deps.runsRepo.finishRun(runId, 'success', {
    commentsFound: fetched.length,
    commentsNotified: newComments.length,
  });
  log.info({ sent: newComments.length }, 'Digest sent');
  return { exitCode: EXIT.OK, newComments: newComments.length, runId };
}
