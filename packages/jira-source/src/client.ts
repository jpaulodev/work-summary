import type { AdfNode } from './adf.js';

export interface JiraIssue {
  id: string;
  key: string;
  fields: { summary: string; updated: string; assignee?: { accountId: string } | null };
}

export interface JiraComment {
  id: string;
  created: string;
  updated: string;
  author: { accountId: string; displayName: string; emailAddress?: string };
  body: AdfNode | null;
}

export interface JiraClientOptions {
  /** OAuth 2.0 (3LO) bearer access token. */
  accessToken: string;
  /** Atlassian cloud id; the REST base becomes api.atlassian.com/ex/jira/{cloudId}. */
  cloudId: string;
  /** Injectable for tests; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class JiraClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: JiraClientOptions) {
    this.authHeader = `Bearer ${opts.accessToken}`;
    this.baseUrl = `https://api.atlassian.com/ex/jira/${opts.cloudId}`;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async req<T>(path: string, attempt = 0): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { authorization: this.authHeader, accept: 'application/json' },
    });
    if (res.status === 429 && attempt < 3) {
      const ra = parseInt(res.headers.get('retry-after') ?? '1', 10);
      await this.sleep(Math.max((Number.isNaN(ra) ? 1 : ra) * 1000, 250 * 2 ** attempt));
      return this.req<T>(path, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`JIRA ${path} -> ${res.status}`);
    }
    return (await res.json()) as T;
  }

  myself(): Promise<{ accountId: string; emailAddress?: string }> {
    return this.req('/rest/api/3/myself');
  }

  search(
    jql: string,
    opts: { fields?: string[]; startAt?: number; maxResults?: number } = {},
  ): Promise<{ issues: JiraIssue[]; total: number; isLast?: boolean }> {
    const params = new URLSearchParams({
      jql,
      startAt: String(opts.startAt ?? 0),
      maxResults: String(opts.maxResults ?? 50),
      fields: (opts.fields ?? ['summary', 'updated', 'assignee']).join(','),
    });
    return this.req(`/rest/api/3/search?${params.toString()}`);
  }

  async listComments(issueKey: string): Promise<JiraComment[]> {
    const r = await this.req<{ comments: JiraComment[] }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=-created`,
    );
    return r.comments;
  }

  async listProjects(): Promise<{ key: string; name: string }[]> {
    const r = await this.req<{ values: { key: string; name: string }[] }>(
      '/rest/api/3/project/search?maxResults=100',
    );
    return r.values;
  }

  listFields(): Promise<{ id: string; name: string; custom: boolean }[]> {
    return this.req('/rest/api/3/field');
  }

  async addComment(issueKey: string, adfBody: unknown): Promise<{ id: string; self: string }> {
    const res = await fetch(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: 'POST',
        headers: {
          authorization: this.authHeader,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ body: adfBody }),
      },
    );
    if (!res.ok) {
      const err = new Error(`JIRA addComment ${issueKey} -> ${res.status}`) as Error & {
        status: number;
      };
      err.status = res.status;
      throw err;
    }
    const data = (await res.json()) as { id: string; self: string };
    return { id: data.id, self: data.self };
  }
}
