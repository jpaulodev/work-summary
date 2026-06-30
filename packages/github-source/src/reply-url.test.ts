import { describe, it, expect } from 'vitest';
import { parseGithubCommentUrl } from './reply-url.js';

describe('parseGithubCommentUrl', () => {
  it('parses a PR review comment URL', () => {
    expect(parseGithubCommentUrl('https://github.com/me/repo/pull/42#discussion_r12345')).toEqual({
      kind: 'pr-review-reply',
      owner: 'me',
      repo: 'repo',
      pullNumber: 42,
      commentId: 12345,
    });
  });

  it('parses a PR issue comment URL', () => {
    expect(parseGithubCommentUrl('https://github.com/me/repo/pull/42#issuecomment-99')).toEqual({
      kind: 'issue-comment',
      owner: 'me',
      repo: 'repo',
      issueNumber: 42,
    });
  });

  it('parses an issue comment URL', () => {
    expect(parseGithubCommentUrl('https://github.com/me/repo/issues/7#issuecomment-100')).toEqual({
      kind: 'issue-comment',
      owner: 'me',
      repo: 'repo',
      issueNumber: 7,
    });
  });

  it('throws on an unknown URL', () => {
    expect(() => parseGithubCommentUrl('https://example.com/x')).toThrow(/unknown/i);
  });
});
