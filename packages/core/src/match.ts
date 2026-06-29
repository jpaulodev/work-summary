import type {
  ScanContext,
  MatchRulesConfig,
  BotFilterConfig,
  PendingComment,
  RawContainer,
  RawComment,
} from './types.js';
import {
  lastCommentByUserAt,
  isAfter,
  toPendingComment,
  reviewSyntheticId,
} from './match-helpers.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Candidate {
  comment: RawComment;
  container: RawContainer;
  rules: PendingComment['matchedRules'];
}

function addRule(
  map: Map<string, Candidate>,
  key: string,
  container: RawContainer,
  comment: RawComment,
  rule: PendingComment['matchedRules'][number],
): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.rules.includes(rule)) existing.rules.push(rule);
  } else {
    map.set(key, { comment, container, rules: [rule] });
  }
}

export function matchComments(
  context: ScanContext,
  rules: MatchRulesConfig,
  filters: BotFilterConfig,
): PendingComment[] {
  const candidates = new Map<string, Candidate>();
  const me = context.userLogin;

  for (const container of context.containers) {
    const myLastAt = lastCommentByUserAt(container, me);

    if (rules.authorOfPrUnanswered && container.type === 'pr' && container.authorLogin === me) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (isAfter(c.createdAt, myLastAt)) {
          addRule(
            candidates,
            `${container.number}:${c.nativeId}`,
            container,
            c,
            'author_of_pr_unanswered',
          );
        }
      }
    }

    if (rules.mentioned) {
      const re = new RegExp(`(^|[^\\w])@${escapeRegex(me)}(?!\\w)`, 'i');
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (re.test(c.body)) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'mentioned');
        }
      }
    }

    if (rules.repliedBeforeThenFollowup && myLastAt !== null) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (c.createdAt > myLastAt) {
          addRule(
            candidates,
            `${container.number}:${c.nativeId}`,
            container,
            c,
            'replied_before_then_followup',
          );
        }
      }
    }

    if (rules.assignee && container.assigneeLogins.includes(me)) {
      for (const c of container.comments) {
        if (c.author.login === me) continue;
        if (isAfter(c.createdAt, myLastAt)) {
          addRule(candidates, `${container.number}:${c.nativeId}`, container, c, 'assignee');
        }
      }
    }

    if (rules.changesRequested && container.type === 'pr' && container.authorLogin === me) {
      for (const review of container.reviews) {
        if (review.state !== 'CHANGES_REQUESTED') continue;
        const after = review.submittedAt;
        const pushedAfter =
          container.lastUserCommitAt !== null && container.lastUserCommitAt > after;
        const repliedAfter = container.comments.some(
          (c) => c.author.login === me && c.createdAt > after,
        );
        if (pushedAfter || repliedAfter) continue;
        const nativeId = reviewSyntheticId(container.number, review);
        const synthetic: RawComment = {
          nativeId,
          url: container.url,
          author: review.author,
          body: `Changes requested by @${review.author.login}`,
          createdAt: review.submittedAt,
        };
        addRule(
          candidates,
          `${container.number}:${nativeId}`,
          container,
          synthetic,
          'changes_requested',
        );
      }
    }
  }

  const out: PendingComment[] = [];
  for (const cand of candidates.values()) {
    if (
      filters.excludeBots &&
      cand.comment.author.isBot &&
      !filters.botWhitelist.includes(cand.comment.author.login)
    ) {
      continue;
    }
    out.push(
      toPendingComment(
        context.source,
        context.repo,
        cand.container,
        cand.comment.nativeId,
        cand.comment.url,
        cand.comment.author,
        cand.comment.body,
        cand.comment.createdAt,
        cand.rules,
        cand.rules.includes('changes_requested')
          ? 'review'
          : cand.container.type === 'pr'
            ? 'pr_comment'
            : 'issue_comment',
      ),
    );
  }
  return out;
}
