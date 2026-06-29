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

function ctx(body: string, authorLogin = 'alice'): ScanContext {
  return {
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
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments: [
          {
            nativeId: 'c1',
            url: '',
            author: { login: authorLogin, isBot: false },
            body,
            createdAt: '2026-06-01T10:00:00Z',
          },
        ],
      },
    ],
  };
}

describe('matchComments - rule B (mentioned)', () => {
  it('matches @me at start of body', () => {
    expect(matchComments(ctx('@me please look'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(
      1,
    );
  });

  it('matches @Me case-insensitively', () => {
    expect(matchComments(ctx('cc @Me'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
  });

  it('does NOT match @method or @members (word boundary)', () => {
    expect(
      matchComments(ctx('use @method here'), rulesOnly('mentioned'), noBotFilter),
    ).toHaveLength(0);
    expect(matchComments(ctx('hi @members'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(0);
  });

  it('does NOT match self-mention', () => {
    expect(
      matchComments(ctx('@me I said', 'me'), rulesOnly('mentioned'), noBotFilter),
    ).toHaveLength(0);
  });

  it('matches @me at end and in middle', () => {
    expect(matchComments(ctx('thanks @me!'), rulesOnly('mentioned'), noBotFilter)).toHaveLength(1);
    expect(
      matchComments(ctx('hi @me how are you'), rulesOnly('mentioned'), noBotFilter),
    ).toHaveLength(1);
  });
});
