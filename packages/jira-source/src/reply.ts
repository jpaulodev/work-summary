import type { JiraClient } from './client.js';
import { textToAdf } from './text-to-adf.js';

export interface JiraReplyContext {
  client: JiraClient;
  issueKey: string;
  body: string;
}

export interface JiraReplyResult {
  id: string;
  self: string;
}

/** Error thrown when the token lacks write permission (HTTP 401/403). */
export class JiraReplyScopeError extends Error {
  readonly code = 'token-write-scope';
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'JiraReplyScopeError';
  }
}

export async function postJiraReply(ctx: JiraReplyContext): Promise<JiraReplyResult> {
  try {
    return await ctx.client.addComment(ctx.issueKey, textToAdf(ctx.body));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new JiraReplyScopeError('JIRA token lacks write permissions', status);
    }
    throw err;
  }
}
