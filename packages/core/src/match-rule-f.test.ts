import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

describe('matchComments - rule F (changes_requested)', () => {
  it('matches an unanswered CHANGES_REQUESTED review on my PR', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: 'feat',
          url: 'https://gh/pr/1',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            {
              state: 'CHANGES_REQUESTED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    const r = matchComments(ctx, rulesOnly('changesRequested'), noBotFilter);
    expect(r).toHaveLength(1);
    expect(r[0]?.matchedRules).toEqual(['changes_requested']);
  });

  it('does NOT match if I pushed a commit after the review', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            {
              state: 'CHANGES_REQUESTED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [],
          lastUserCommitAt: '2026-06-01T11:00:00Z',
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match if I commented after the review', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            {
              state: 'CHANGES_REQUESTED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [
            {
              nativeId: 'c1',
              url: '',
              author: { login: 'me', isBot: false },
              body: 'fixed',
              createdAt: '2026-06-01T11:00:00Z',
            },
          ],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match APPROVED or COMMENTED reviews', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [
            {
              state: 'APPROVED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
            {
              state: 'COMMENTED',
              author: { login: 'bob', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match if PR not authored by me', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: [],
          reviews: [
            {
              state: 'CHANGES_REQUESTED',
              author: { login: 'alice', isBot: false },
              submittedAt: '2026-06-01T10:00:00Z',
            },
          ],
          comments: [],
          lastUserCommitAt: null,
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('changesRequested'), noBotFilter)).toHaveLength(0);
  });
});
