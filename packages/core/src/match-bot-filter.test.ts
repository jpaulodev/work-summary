import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig } from './types.js';

const allRules: MatchRulesConfig = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

function ctxWithBot(isBot: boolean, login = 'dependabot[bot]'): ScanContext {
  return {
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
        reviews: [],
        lastUserCommitAt: null,
        comments: [
          {
            nativeId: 'c1',
            url: '',
            author: { login, isBot },
            body: 'bump',
            createdAt: '2026-06-01T10:00:00Z',
          },
        ],
      },
    ],
  };
}

describe('matchComments - bot filter', () => {
  it('excludes bot comments when excludeBots=true', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: [] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(0);
  });

  it('includes whitelisted bot even when excludeBots=true', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: ['dependabot[bot]'] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(1);
  });

  it('includes bot comments when excludeBots=false', () => {
    const filters: BotFilterConfig = { excludeBots: false, botWhitelist: [] };
    expect(matchComments(ctxWithBot(true), allRules, filters)).toHaveLength(1);
  });

  it('never filters human comments', () => {
    const filters: BotFilterConfig = { excludeBots: true, botWhitelist: [] };
    expect(matchComments(ctxWithBot(false, 'alice'), allRules, filters)).toHaveLength(1);
  });
});
