import { computePendingCommentId, type PendingComment } from '@work-summary/core';
import type { JiraSiteRow, JiraProjectRow } from '@work-summary/storage';
import { JiraClient } from './client.js';
import { adfToText } from './adf.js';

export interface JiraSourceDeps {
  sites: JiraSiteRow[];
  projects: JiraProjectRow[];
  decryptToken: (encryptedToken: string, nonce: string) => string;
  /** Lookback window for comments. */
  since: Date;
  /** Injectable for tests. */
  makeClient?: (opts: { baseUrl: string; email: string; token: string }) => JiraClient;
  sleep?: (ms: number) => Promise<void>;
}

function issueNumber(key: string): number {
  const m = /-(\d+)$/.exec(key);
  return m && m[1] ? parseInt(m[1], 10) : 0;
}

/**
 * Fetches pending JIRA comments and normalizes them to the shared PendingComment
 * shape so they flow through the same dedup / storage / notifier / dashboard path
 * as GitHub comments.
 */
export class JiraSource {
  readonly id = 'jira' as const;
  constructor(private readonly deps: JiraSourceDeps) {}

  async fetchPendingComments(): Promise<PendingComment[]> {
    const out: PendingComment[] = [];
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    for (const site of this.deps.sites.filter((s) => s.enabled)) {
      const client = this.makeClient(site);
      const me = await client.myself();
      const projects = this.deps.projects.filter((p) => p.siteId === site.id);

      for (const project of projects) {
        const devClause = site.developerFieldId
          ? ` OR "${site.developerFieldId}" = currentUser()`
          : '';
        const jql =
          `project = "${project.projectKey}" AND ` +
          `(assignee = currentUser() OR reporter = currentUser()${devClause}) AND ` +
          `updated >= -7d ORDER BY updated DESC`;
        const result = await client.search(jql);

        for (const issue of result.issues) {
          const comments = await client.listComments(issue.key);
          await sleep(100);
          for (const c of comments) {
            if (c.author.accountId === me.accountId) continue;
            if (new Date(c.created) < this.deps.since) continue;
            const browseUrl = `${site.baseUrl}/browse/${issue.key}`;
            out.push({
              id: computePendingCommentId({
                source: 'jira',
                repo: `${site.baseUrl}/${project.projectKey}`,
                type: 'jira_comment',
                nativeId: `${issue.key}:${c.id}`,
              }),
              source: 'jira',
              repo: `${site.baseUrl} :: ${project.projectKey}`,
              containerType: 'issue',
              containerNumber: issueNumber(issue.key),
              containerTitle: issue.fields.summary,
              containerUrl: browseUrl,
              commentId: c.id,
              commentUrl: `${browseUrl}?focusedCommentId=${c.id}`,
              author: { login: c.author.displayName, isBot: false },
              body: adfToText(c.body).slice(0, 2000),
              createdAt: c.created,
              matchedRules: ['assignee'],
              issueKey: issue.key,
            });
          }
        }
      }
    }
    return out;
  }

  private makeClient(site: JiraSiteRow): JiraClient {
    const token = this.deps.decryptToken(site.encryptedToken, site.tokenNonce);
    const opts = { baseUrl: site.baseUrl, email: site.email, token };
    return this.deps.makeClient
      ? this.deps.makeClient(opts)
      : new JiraClient({ ...opts, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
  }
}
