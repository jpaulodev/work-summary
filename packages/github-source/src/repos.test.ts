import { describe, it, expect, vi } from 'vitest';
import { listAccessibleRepos } from './repos.js';
import type { GithubClient } from './client.js';

function octokitWithPages(pages: Array<Array<{ full_name: string; private: boolean }>>) {
  return {
    rest: { repos: { listForAuthenticatedUser: 'LIST_ROUTE' } },
    paginate: {
      iterator: vi.fn().mockImplementation(async function* () {
        await Promise.resolve();
        for (const data of pages) yield { data };
      }),
    },
  } as unknown as GithubClient;
}

describe('listAccessibleRepos', () => {
  it('flattens paginated results to {fullName, private}', async () => {
    const client = octokitWithPages([
      [{ full_name: 'me/a', private: false }],
      [{ full_name: 'org/b', private: true }],
    ]);
    expect(await listAccessibleRepos(client)).toEqual([
      { fullName: 'me/a', private: false },
      { fullName: 'org/b', private: true },
    ]);
  });

  it('caps the number of repos returned', async () => {
    const client = octokitWithPages([
      [
        { full_name: 'a/1', private: false },
        { full_name: 'a/2', private: false },
        { full_name: 'a/3', private: false },
      ],
    ]);
    const repos = await listAccessibleRepos(client, { max: 2 });
    expect(repos.map((r) => r.fullName)).toEqual(['a/1', 'a/2']);
  });
});
