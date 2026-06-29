import type { RawComment } from '@work-summary/core';
import type { GithubClient } from './client.js';

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo "${repo}"`);
  return { owner, repo: name };
}

function isBot(login: string, type: string | undefined): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

export async function fetchIssueComments(
  client: GithubClient,
  repo: string,
  number: number,
  since?: string,
): Promise<RawComment[]> {
  const { owner, repo: name } = splitRepo(repo);
  const params: {
    owner: string;
    repo: string;
    issue_number: number;
    per_page: number;
    since?: string;
  } = {
    owner,
    repo: name,
    issue_number: number,
    per_page: 100,
  };
  if (since) params.since = since;
  const items = await client.paginate(client.rest.issues.listComments, params);
  return items.map((c) => ({
    nativeId: String(c.id),
    url: c.html_url,
    author: { login: c.user?.login ?? 'ghost', isBot: isBot(c.user?.login ?? '', c.user?.type) },
    body: c.body ?? '',
    createdAt: c.created_at,
  }));
}

export async function fetchPrReviewComments(
  client: GithubClient,
  repo: string,
  number: number,
  since?: string,
): Promise<RawComment[]> {
  const { owner, repo: name } = splitRepo(repo);
  const params: {
    owner: string;
    repo: string;
    pull_number: number;
    per_page: number;
    since?: string;
  } = {
    owner,
    repo: name,
    pull_number: number,
    per_page: 100,
  };
  if (since) params.since = since;
  const items = await client.paginate(client.rest.pulls.listReviewComments, params);
  return items.map((c) => ({
    nativeId: String(c.id),
    url: c.html_url,
    author: { login: c.user?.login ?? 'ghost', isBot: isBot(c.user?.login ?? '', c.user?.type) },
    body: c.body ?? '',
    createdAt: c.created_at,
  }));
}
