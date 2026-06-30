import { describe, it, expect, vi } from 'vitest';
import { postGithubReply } from './reply.js';
import type { GithubClient } from './client.js';

function octokit(impl: (route: string, params: Record<string, unknown>) => Promise<unknown>) {
  return { request: vi.fn().mockImplementation(impl) } as unknown as Pick<GithubClient, 'request'>;
}

describe('postGithubReply', () => {
  it('replies to a PR review comment via the /replies endpoint', async () => {
    const client = octokit((route, params) => {
      expect(route).toBe(
        'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
      );
      expect(params).toMatchObject({
        owner: 'me',
        repo: 'repo',
        pull_number: 42,
        comment_id: 12345,
        body: 'thanks!',
      });
      return Promise.resolve({ data: { id: 999, html_url: 'https://x/999' } });
    });
    const r = await postGithubReply({
      octokit: client,
      commentUrl: 'https://github.com/me/repo/pull/42#discussion_r12345',
      body: 'thanks!',
    });
    expect(r).toEqual({ id: 999, url: 'https://x/999' });
  });

  it('replies to an issue comment via the /comments endpoint', async () => {
    const client = octokit((route, params) => {
      expect(route).toBe('POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
      expect(params).toMatchObject({ owner: 'me', repo: 'repo', issue_number: 7, body: 'ack' });
      return Promise.resolve({ data: { id: 100, html_url: 'https://x/100' } });
    });
    const r = await postGithubReply({
      octokit: client,
      commentUrl: 'https://github.com/me/repo/issues/7#issuecomment-50',
      body: 'ack',
    });
    expect(r.id).toBe(100);
  });

  it('maps 403 to a token-write-scope error', async () => {
    const client = octokit(() =>
      Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })),
    );
    await expect(
      postGithubReply({
        octokit: client,
        commentUrl: 'https://github.com/me/repo/issues/1#issuecomment-1',
        body: 'x',
      }),
    ).rejects.toMatchObject({ code: 'token-write-scope' });
  });
});
