import type { RawComment } from '@work-summary/core';
import type { GithubClient } from './client.js';
import { splitRepo, toRawComment } from './repo.js';

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
  return items.map(toRawComment);
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
  return items.map(toRawComment);
}
