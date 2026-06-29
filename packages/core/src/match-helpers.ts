import type { RawContainer, PendingComment, RawReview } from './types.js';
import { computePendingCommentId } from './id.js';

export function lastCommentByUserAt(container: RawContainer, login: string): string | null {
  let latest: string | null = null;
  for (const c of container.comments) {
    if (c.author.login === login) {
      if (!latest || c.createdAt > latest) latest = c.createdAt;
    }
  }
  return latest;
}

export function isAfter(a: string, b: string | null): boolean {
  return b === null ? true : a > b;
}

export function reviewSyntheticId(containerNumber: number, review: RawReview): string {
  return `review:${containerNumber}:${review.author.login}:${review.submittedAt}`;
}

export function toPendingComment(
  source: 'github',
  repo: string,
  container: RawContainer,
  commentNativeId: string,
  commentUrl: string,
  author: { login: string; isBot: boolean },
  body: string,
  createdAt: string,
  matched: PendingComment['matchedRules'],
  type: 'pr_comment' | 'issue_comment' | 'review',
): PendingComment {
  return {
    id: computePendingCommentId({ source, repo, type, nativeId: commentNativeId }),
    source,
    repo,
    containerType: container.type,
    containerNumber: container.number,
    containerTitle: container.title,
    containerUrl: container.url,
    commentId: commentNativeId,
    commentUrl,
    author,
    body,
    createdAt,
    matchedRules: matched,
  };
}
