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
  baseUrl: string;
  email: string;
  token: string;
  /** Injectable for tests; defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class JiraClient {
  private readonly authHeader: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: JiraClientOptions) {
    this.authHeader = 'Basic ' + Buffer.from(`${opts.email}:${opts.token}`).toString('base64');
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async req<T>(path: string, attempt = 0): Promise<T> {
    const res = await fetch(`${this.opts.baseUrl}${path}`, {
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
}
