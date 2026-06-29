import { describe, it, expect } from 'vitest';
import { runDoctor } from './doctor.js';
import type { Config } from '../config.js';

const cfg: Config = {
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
  scan: { lookbackDays: 7, concurrency: 3 },
  notifications: [
    {
      id: 'n',
      type: 'smtp',
      enabled: true,
      smtp: { host: 'h', port: 25, secure: false, user: 'u', pass: 'p' },
      from: 'a',
      to: 'b',
      subjectTemplate: 's',
    },
  ],
  logging: { level: 'info', file: '/tmp/x.log' },
};

const okDeps = {
  makeOctokit: () =>
    ({
      rest: { users: { getAuthenticated: () => Promise.resolve({ data: { login: 'me' } }) } },
    }) as never,
  makeSmtp: () => ({ verify: () => Promise.resolve() }),
  openDb: () =>
    ({
      pragma: () => undefined,
      exec: () => undefined,
      prepare: () => ({ all: () => [], get: () => undefined, run: () => undefined }),
    }) as never,
  dbPath: ':memory:',
};

describe('runDoctor', () => {
  it('returns all checks ok when deps succeed', async () => {
    const r = await runDoctor({ config: cfg, deps: okDeps });
    expect(r.allOk).toBe(true);
    expect(r.checks.find((c) => c.name === 'github')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'smtp')?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === 'storage')?.ok).toBe(true);
  });

  it('reports github failure on auth error', async () => {
    const r = await runDoctor({
      config: cfg,
      deps: {
        ...okDeps,
        makeOctokit: () => ({
          rest: { users: { getAuthenticated: () => Promise.reject(new Error('401')) } },
        }),
      },
    });
    expect(r.allOk).toBe(false);
    expect(r.checks.find((c) => c.name === 'github')?.ok).toBe(false);
  });

  it('reports smtp failure', async () => {
    const r = await runDoctor({
      config: cfg,
      deps: { ...okDeps, makeSmtp: () => ({ verify: () => Promise.reject(new Error('refused')) }) },
    });
    expect(r.checks.find((c) => c.name === 'smtp')?.ok).toBe(false);
  });
});
