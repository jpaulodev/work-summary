export type GithubCommentLocation =
  | {
      kind: 'pr-review-reply';
      owner: string;
      repo: string;
      pullNumber: number;
      commentId: number;
    }
  | { kind: 'issue-comment'; owner: string; repo: string; issueNumber: number };

const PR_REVIEW = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#discussion_r(\d+)$/;
const PR_ISSUE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#issuecomment-\d+$/;
const ISSUE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)#issuecomment-\d+$/;

export function parseGithubCommentUrl(url: string): GithubCommentLocation {
  const review = PR_REVIEW.exec(url);
  if (review) {
    return {
      kind: 'pr-review-reply',
      owner: review[1]!,
      repo: review[2]!,
      pullNumber: Number(review[3]),
      commentId: Number(review[4]),
    };
  }
  const prIssue = PR_ISSUE.exec(url);
  if (prIssue) {
    return {
      kind: 'issue-comment',
      owner: prIssue[1]!,
      repo: prIssue[2]!,
      issueNumber: Number(prIssue[3]),
    };
  }
  const issue = ISSUE.exec(url);
  if (issue) {
    return {
      kind: 'issue-comment',
      owner: issue[1]!,
      repo: issue[2]!,
      issueNumber: Number(issue[3]),
    };
  }
  throw new Error(`unknown GitHub comment URL: ${url}`);
}
