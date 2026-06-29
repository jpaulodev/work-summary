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

describe('matchComments - rule E (assignee)', () => {
  it('matches comments on issues where I am assigned and have not replied', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['me', 'jane'],
          reviews: [],
          lastUserCommitAt: null,
          comments: [
            {
              nativeId: 'c1',
              url: '',
              author: { login: 'alice', isBot: false },
              body: 'help',
              createdAt: '2026-06-01T10:00:00Z',
            },
          ],
        },
      ],
    };
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(1);
  });

  it('does NOT match when I am not assigned', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['jane'],
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
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match when I already replied after the comment', () => {
    const ctx: ScanContext = {
      source: 'github',
      repo: 'org/repo',
      userLogin: 'me',
      containers: [
        {
          type: 'issue',
          number: 1,
          title: '',
          url: '',
          authorLogin: 'other',
          assigneeLogins: ['me'],
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
    expect(matchComments(ctx, rulesOnly('assignee'), noBotFilter)).toHaveLength(0);
  });
});
