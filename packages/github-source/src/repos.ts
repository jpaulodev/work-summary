import type { GithubClient } from './client.js';

export interface AccessibleRepo {
  fullName: string;
  private: boolean;
}

/**
 * List the repositories the authenticated user can access (owned, collaborator,
 * or org member), most-recently-updated first. Paginated; capped so a user in
 * many orgs doesn't fetch unbounded pages.
 */
export async function listAccessibleRepos(
  octokit: GithubClient,
  opts: { max?: number } = {},
): Promise<AccessibleRepo[]> {
  const max = opts.max ?? 1000;
  const out: AccessibleRepo[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'updated',
    affiliation: 'owner,collaborator,organization_member',
  });
  for await (const { data } of iterator) {
    for (const r of data) {
      out.push({ fullName: r.full_name, private: r.private });
      if (out.length >= max) return out;
    }
  }
  return out;
}
