import type { RawReview } from '@work-summary/core';
import type { GithubClient } from './client.js';

export interface RawPullRequest {
  number: number;
  title: string;
  htmlUrl: string;
  authorLogin: string;
  assigneeLogins: string[];
  lastCommitAt: string | null;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo "${repo}", expected "owner/name"`);
  return { owner, repo: name };
}

function isBot(login: string, type: string | undefined): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

export async function fetchOpenPullRequests(
  client: GithubClient,
  repo: string,
): Promise<RawPullRequest[]> {
  const { owner, repo: name } = splitRepo(repo);
  const prs = await client.paginate(client.rest.pulls.list, {
    owner,
    repo: name,
    state: 'open',
    per_page: 100,
  });
  const result: RawPullRequest[] = [];
  for (const p of prs) {
    let lastCommitAt: string | null = null;
    if (p.head?.sha) {
      try {
        const commit = await client.rest.repos.getCommit({ owner, repo: name, ref: p.head.sha });
        lastCommitAt = commit.data.commit.author?.date ?? null;
      } catch {
        lastCommitAt = null;
      }
    }
    result.push({
      number: p.number,
      title: p.title,
      htmlUrl: p.html_url,
      authorLogin: p.user?.login ?? 'ghost',
      assigneeLogins: (p.assignees ?? []).map((a) => a.login),
      lastCommitAt,
    });
  }
  return result;
}

export async function fetchPullRequestReviews(
  client: GithubClient,
  repo: string,
  number: number,
): Promise<RawReview[]> {
  const { owner, repo: name } = splitRepo(repo);
  const reviews = await client.paginate(client.rest.pulls.listReviews, {
    owner,
    repo: name,
    pull_number: number,
    per_page: 100,
  });
  return reviews.map((r) => ({
    state: (r.state as RawReview['state']) ?? 'COMMENTED',
    author: { login: r.user?.login ?? 'ghost', isBot: isBot(r.user?.login ?? '', r.user?.type) },
    submittedAt: r.submitted_at ?? '',
  }));
}
