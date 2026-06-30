import { describe, it, expect } from 'vitest';
import { runScan } from './scan.js';
import {
  openDatabase,
  runMigrations,
  createCommentsRepo,
  createRunsRepo,
  createWatermarksRepo,
} from '@work-summary/storage';
import pino from 'pino';
import type { PendingComment } from '@work-summary/core';
import type { Config } from '../config.js';

function sampleComment(id: string): PendingComment {
  return {
    id,
    source: 'github',
    repo: 'org/r',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: '',
    containerUrl: '',
    commentId: id,
    commentUrl: '',
    author: { login: 'a', isBot: false },
    body: '',
    createdAt: '2026-06-01T00:00:00Z',
    matchedRules: ['mentioned'],
  };
}

function baseConfig(): Config {
  return {
    user: { githubLogin: 'me' },
    sources: {
      github: {
        token: 't',
        repos: ['org/r'],
        rules: {
          authorOfPrUnanswered: true,
          mentioned: true,
          repliedBeforeThenFollowup: true,
          assignee: true,
          changesRequested: true,
        },
        filters: { excludeBots: false, botWhitelist: [] },
      },
    },
    scan: { lookbackDays: 7, concurrency: 1 },
    notifications: [
      {
        id: 'n',
        type: 'smtp',
        enabled: true,
        smtp: { host: 'h', port: 25, secure: false, user: '', pass: '' },
        from: 'a',
        to: 'b',
        subjectTemplate: '[ws] {{count}} - {{date}}',
      },
    ],
    logging: { level: 'silent' as never, file: '/tmp/x.log' },
  };
}

function makeDeps(
  comments: PendingComment[],
  sendImpl: (c: PendingComment[]) => Promise<void> = () => Promise.resolve(),
) {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return {
    db,
    commentsRepo: createCommentsRepo(db, 1),
    runsRepo: createRunsRepo(db, 1, () => new Date('2026-06-01T00:00:00Z')),
    watermarksRepo: createWatermarksRepo(db, 1),
    source: { id: 'github' as const, fetchPendingComments: () => Promise.resolve(comments) },
    notifier: { id: 'smtp', send: (p: { comments: PendingComment[] }) => sendImpl(p.comments) },
    logger: pino({ level: 'silent' }),
  };
}

describe('runScan', () => {
  it('sends and marks notified on first run', async () => {
    const deps = makeDeps([sampleComment('a'), sampleComment('b')]);
    const r = await runScan({
      config: baseConfig(),
      deps,
      dryRun: false,
      now: () => new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(2);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a'), sampleComment('b')])).toEqual(
      [],
    );
  });

  it('exits 0 with 0 new when nothing matches', async () => {
    const deps = makeDeps([]);
    const r = await runScan({
      config: baseConfig(),
      deps,
      dryRun: false,
      now: () => new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(0);
  });

  it('dedups: second run with same comments sends nothing', async () => {
    const cfg = baseConfig();
    const deps1 = makeDeps([sampleComment('a')]);
    await runScan({
      config: cfg,
      deps: deps1,
      dryRun: false,
      now: () => new Date('2026-06-01T00:00:00Z'),
    });

    let sent = 0;
    const deps2 = {
      ...deps1,
      source: {
        id: 'github' as const,
        fetchPendingComments: () => Promise.resolve([sampleComment('a')]),
      },
      notifier: {
        id: 'smtp',
        send: () => {
          sent++;
          return Promise.resolve();
        },
      },
    };
    const r = await runScan({
      config: cfg,
      deps: deps2,
      dryRun: false,
      now: () => new Date('2026-06-02T00:00:00Z'),
    });
    expect(r.exitCode).toBe(0);
    expect(r.newComments).toBe(0);
    expect(sent).toBe(0);
  });

  it('exits 10 on dry-run and does NOT mark notified', async () => {
    const deps = makeDeps([sampleComment('a')]);
    const r = await runScan({
      config: baseConfig(),
      deps,
      dryRun: true,
      now: () => new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.exitCode).toBe(10);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a')])).toHaveLength(1);
  });

  it('exits 4 on SMTP failure and does NOT mark notified', async () => {
    const deps = makeDeps([sampleComment('a')], () =>
      Promise.reject(Object.assign(new Error('refused'), { name: 'SmtpError' })),
    );
    const r = await runScan({
      config: baseConfig(),
      deps,
      dryRun: false,
      now: () => new Date('2026-06-01T00:00:00Z'),
    });
    expect(r.exitCode).toBe(4);
    expect(deps.commentsRepo.filterUnnotified([sampleComment('a')])).toHaveLength(1);
  });
});
