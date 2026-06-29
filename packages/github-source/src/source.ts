import pLimit from 'p-limit';
import {
  matchComments,
  type PendingComment,
  type MatchRulesConfig,
  type BotFilterConfig,
  type RawContainer,
  type RawComment,
  type ScanContext,
} from '@work-summary/core';
import type { GithubClient } from './client.js';
import { fetchOpenPullRequests, fetchPullRequestReviews } from './fetch-prs.js';
import { fetchIssueComments, fetchPrReviewComments } from './fetch-comments.js';
import { fetchMentionedContainers, type MentionRef } from './fetch-mentions.js';

export interface FetchOptions {
  repos: string[];
  userLogin: string;
  sinceByRepo: Record<string, string | undefined>;
  defaultSince: string;
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
  concurrency: number;
}

export interface Source {
  readonly id: 'github' | 'jira';
  fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]>;
}

function dedupComments(comments: RawComment[]): RawComment[] {
  const seen = new Set<string>();
  const out: RawComment[] = [];
  for (const c of comments) {
    if (seen.has(c.nativeId)) continue;
    seen.add(c.nativeId);
    out.push(c);
  }
  return out;
}

export class GithubSource implements Source {
  readonly id = 'github' as const;
  constructor(private readonly client: GithubClient) {}

  async fetchPendingComments(opts: FetchOptions): Promise<PendingComment[]> {
    const limit = pLimit(opts.concurrency);
    const perRepo = await Promise.all(
      opts.repos.map((repo) => limit(() => this.scanRepo(repo, opts))),
    );
    return perRepo.flat();
  }

  private async scanRepo(repo: string, opts: FetchOptions): Promise<PendingComment[]> {
    const since = opts.sinceByRepo[repo] ?? opts.defaultSince;
    const [prs, mentions] = await Promise.all([
      fetchOpenPullRequests(this.client, repo),
      fetchMentionedContainers(this.client, { login: opts.userLogin, repos: [repo], since }),
    ]);

    const containers: RawContainer[] = [];

    for (const pr of prs) {
      const [reviews, issueCmt, reviewCmt] = await Promise.all([
        fetchPullRequestReviews(this.client, repo, pr.number),
        fetchIssueComments(this.client, repo, pr.number, since),
        fetchPrReviewComments(this.client, repo, pr.number, since),
      ]);
      containers.push({
        type: 'pr',
        number: pr.number,
        title: pr.title,
        url: pr.htmlUrl,
        authorLogin: pr.authorLogin,
        assigneeLogins: pr.assigneeLogins,
        reviews,
        lastUserCommitAt: pr.lastCommitAt,
        comments: dedupComments([...issueCmt, ...reviewCmt]),
      });
    }

    const prNumbers = new Set(prs.map((p) => p.number));
    const issueMentions: MentionRef[] = mentions.filter(
      (m) => m.type === 'issue' && !prNumbers.has(m.number),
    );
    for (const m of issueMentions) {
      const comments = await fetchIssueComments(this.client, repo, m.number, since);
      containers.push({
        type: 'issue',
        number: m.number,
        title: `#${m.number}`,
        url: `https://github.com/${repo}/issues/${m.number}`,
        authorLogin: 'unknown',
        assigneeLogins: [],
        reviews: [],
        lastUserCommitAt: null,
        comments,
      });
    }

    const ctx: ScanContext = {
      source: 'github',
      repo,
      userLogin: opts.userLogin,
      containers,
    };
    return matchComments(ctx, opts.rules, opts.filters);
  }
}
