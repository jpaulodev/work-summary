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

describe('matchComments - rule A (author_of_pr_unanswered)', () => {
  it('matches a comment from someone else on my PR when I have not replied since', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: 'feat: x',
          url: 'https://gh/pr/7',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: 'https://gh/c1',
              author: { login: 'alice', isBot: false },
              body: 'please update',
              createdAt: '2026-06-01T10:00:00Z',
            },
          ],
        },
      ],
    };
    const result = matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter);
    expect(result).toHaveLength(1);
    expect(result[0]?.commentId).toBe('c1');
    expect(result[0]?.matchedRules).toEqual(['author_of_pr_unanswered']);
  });

  it('does NOT match when I replied after the comment', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: '',
              author: { login: 'alice', isBot: false },
              body: '',
              createdAt: '2026-06-01T10:00:00Z',
            },
            {
              nativeId: 'c2',
              url: '',
              author: { login: 'me', isBot: false },
              body: '',
              createdAt: '2026-06-01T11:00:00Z',
            },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match PRs not authored by me', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'pr',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: '',
              author: { login: 'alice', isBot: false },
              body: '',
              createdAt: '2026-06-01T10:00:00Z',
            },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match issues (rule A is PR-only)', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 7,
          title: '',
          url: '',
          authorLogin: 'me',
          assigneeLogins: [],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: '',
              author: { login: 'alice', isBot: false },
              body: '',
              createdAt: '2026-06-01T10:00:00Z',
            },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('authorOfPrUnanswered'), noBotFilter)).toHaveLength(0);
  });
});
