import { describe, it, expect } from 'vitest';
import { computePendingCommentId } from './id.js';

describe('computePendingCommentId', () => {
  it('produces deterministic 16-char hex for same inputs', () => {
    const a = computePendingCommentId({
      source: 'github',
      repo: 'org/r',
      type: 'pr_comment',
      nativeId: '123',
    });
    const b = computePendingCommentId({
      source: 'github',
      repo: 'org/r',
      type: 'pr_comment',
      nativeId: '123',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it('differs when any field differs', () => {
    const base = { source: 'github', repo: 'org/r', type: 'pr_comment', nativeId: '123' };
    const ids = new Set([
      computePendingCommentId(base),
      computePendingCommentId({ ...base, source: 'jira' }),
      computePendingCommentId({ ...base, repo: 'org/r2' }),
      computePendingCommentId({ ...base, type: 'issue_comment' }),
      computePendingCommentId({ ...base, nativeId: '124' }),
    ]);
    expect(ids.size).toBe(5);
  });
});
