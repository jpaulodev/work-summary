import { computePendingCommentId, type PendingComment } from '@work-summary/core';
import type { JiraSiteRow, JiraProjectRow } from '@work-summary/storage';
import { JiraClient } from './client.js';
import { adfToText } from './adf.js';

export interface JiraSourceDeps {
  sites: JiraSiteRow[];
  projects: JiraProjectRow[];
  /** OAuth 2.0 bearer token (already refreshed) for the connected Atlassian account. */
  accessToken: string;
  /** Atlassian cloud id of the connected site. */
  cloudId: string;
  /** Lookback window for comments. */
  since: Date;
  /** Number of days back to search issues by; defaults to 7. */
  lookbackDays?: number;
  /** Injectable for tests. */
  makeClient?: (opts: { accessToken: string; cloudId: string }) => JiraClient;
  sleep?: (ms: number) => Promise<void>;
  logger?: { error: (msg: string, err: unknown) => void };
}

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]+$/;
const CUSTOM_FIELD_RE = /^customfield_\d+$/;

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
    const lookbackDays = this.deps.lookbackDays ?? 7;

    for (const site of this.deps.sites.filter((s) => s.enabled)) {
      // Isolate failures per site so one bad token/site does not lose the rest.
      try {
        await this.scanSite(site, lookbackDays, sleep, out);
      } catch (err) {
        this.deps.logger?.error(`[jira] site ${site.baseUrl} failed`, err);
      }
    }
    return out;
  }

  private async scanSite(
    site: JiraSiteRow,
    lookbackDays: number,
    sleep: (ms: number) => Promise<void>,
    out: PendingComment[],
  ): Promise<void> {
    const client = this.makeClient(site);
    const me = await client.myself();
    const projects = this.deps.projects.filter((p) => p.siteId === site.id);
    // Only interpolate values that match strict allow-list patterns into JQL.
    const devFieldId =
      site.developerFieldId && CUSTOM_FIELD_RE.test(site.developerFieldId)
        ? site.developerFieldId
        : null;

    for (const project of projects) {
      if (!PROJECT_KEY_RE.test(project.projectKey)) continue;
      const devClause = devFieldId ? ` OR "${devFieldId}" = currentUser()` : '';
      const jql =
        `project = "${project.projectKey}" AND ` +
        `(assignee = currentUser() OR reporter = currentUser()${devClause}) AND ` +
        `updated >= -${lookbackDays}d ORDER BY updated DESC`;
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

  private makeClient(_site: JiraSiteRow): JiraClient {
    const opts = { accessToken: this.deps.accessToken, cloudId: this.deps.cloudId };
    return this.deps.makeClient
      ? this.deps.makeClient(opts)
      : new JiraClient({ ...opts, ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}) });
  }
}
