import type { GithubClient } from './client.js';
import { parseGithubCommentUrl } from './reply-url.js';

export interface GithubReplyContext {
  octokit: Pick<GithubClient, 'request'>;
  commentUrl: string;
  body: string;
}

export interface GithubReplyResult {
  id: number;
  url: string;
}

/** Error thrown when the token lacks write scope (HTTP 401/403). */
export class ReplyScopeError extends Error {
  readonly code = 'token-write-scope';
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ReplyScopeError';
  }
}

export async function postGithubReply(ctx: GithubReplyContext): Promise<GithubReplyResult> {
  const loc = parseGithubCommentUrl(ctx.commentUrl);
  try {
    if (loc.kind === 'pr-review-reply') {
      const res = await ctx.octokit.request(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
        {
          owner: loc.owner,
          repo: loc.repo,
          pull_number: loc.pullNumber,
          comment_id: loc.commentId,
          body: ctx.body,
        },
      );
      return { id: res.data.id, url: res.data.html_url };
    }
    const res = await ctx.octokit.request(
      'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
      { owner: loc.owner, repo: loc.repo, issue_number: loc.issueNumber, body: ctx.body },
    );
    return { id: res.data.id, url: res.data.html_url };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new ReplyScopeError('GitHub token lacks write scope', status);
    }
    throw err;
  }
}
