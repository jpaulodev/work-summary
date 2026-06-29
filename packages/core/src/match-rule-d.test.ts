import { describe, it, expect } from 'vitest';
import { matchComments } from './match.js';
import type { ScanContext, MatchRulesConfig, BotFilterConfig, RawComment } from './types.js';

const rulesOnly = (key: keyof MatchRulesConfig): MatchRulesConfig => ({
  authorOfPrUnanswered: false,
  mentioned: false,
  repliedBeforeThenFollowup: false,
  assignee: false,
  changesRequested: false,
  [key]: true,
});
const noBotFilter: BotFilterConfig = { excludeBots: false, botWhitelist: [] };

function mkComment(nativeId: string, login: string, createdAt: string): RawComment {
  return { nativeId, url: '', author: { login, isBot: false }, body: '', createdAt };
}

function ctx(comments: RawComment[]): ScanContext {
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
        authorLogin: 'other',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments,
      },
    ],
  };
}

describe('matchComments - rule D (replied_before_then_followup)', () => {
  it('matches comments after my last comment from others', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
        mkComment('c3', 'bob', '2026-06-01T12:00:00Z'),
        mkComment('c4', 'alice', '2026-06-01T13:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r.map((x) => x.commentId).sort()).toEqual(['c3', 'c4']);
  });

  it('does NOT match if I never commented', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'bob', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });

  it('does NOT match my own follow-up comments', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'me', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });

  it('does NOT match if my comment is latest', () => {
    const r = matchComments(
      ctx([
        mkComment('c1', 'alice', '2026-06-01T10:00:00Z'),
        mkComment('c2', 'me', '2026-06-01T11:00:00Z'),
      ]),
      rulesOnly('repliedBeforeThenFollowup'),
      noBotFilter,
    );
    expect(r).toHaveLength(0);
  });
});
