import type { GithubClient } from './client.js';

export interface MentionRef {
  repo: string;
  number: number;
  type: 'pr' | 'issue';
}

export interface FetchMentionsOptions {
  login: string;
  repos: string[];
  since?: string;
}

function buildQuery(opts: FetchMentionsOptions): string {
  const repoQ = opts.repos.map((r) => `repo:${r}`).join(' ');
  const sinceQ = opts.since ? ` updated:>=${opts.since}` : '';
  return `mentions:${opts.login} is:open ${repoQ}${sinceQ}`.trim();
}

function repoFromUrl(url: string): string {
  const idx = url.indexOf('/repos/');
  if (idx === -1) return '';
  return url.slice(idx + '/repos/'.length);
}

export async function fetchMentionedContainers(
  client: GithubClient,
  opts: FetchMentionsOptions,
): Promise<MentionRef[]> {
  if (opts.repos.length === 0) return [];
  const q = buildQuery(opts);
  const items = await client.paginate(client.rest.search.issuesAndPullRequests, {
    q,
    per_page: 100,
  });
  return items.map((it) => ({
    repo: repoFromUrl(it.repository_url ?? ''),
    number: it.number,
    type: it.pull_request ? ('pr' as const) : ('issue' as const),
  }));
}
