import { describe, it, expect } from 'vitest';
import { renderDigest } from './render.js';
import type { PendingComment } from '@work-summary/core';

function mk(overrides: Partial<PendingComment>): PendingComment {
  return {
    id: 'id1',
    source: 'github',
    repo: 'org/a',
    containerType: 'pr',
    containerNumber: 1,
    containerTitle: 'feat: x',
    containerUrl: 'https://gh/pr/1',
    commentId: 'c1',
    commentUrl: 'https://gh/c1',
    author: { login: 'alice', isBot: false },
    body: 'please review',
    createdAt: '2026-06-01T10:00:00Z',
    matchedRules: ['mentioned'],
    ...overrides,
  };
}

describe('renderDigest', () => {
  it('renders empty state when no comments', () => {
    const { html, text } = renderDigest({
      subject: 'test',
      comments: [],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toContain('No new comments');
    expect(text).toContain('No new comments');
  });

  it('groups comments by repo then by container', () => {
    const comments = [
      mk({ id: '1', repo: 'org/a', containerNumber: 1, commentId: 'c1' }),
      mk({ id: '2', repo: 'org/a', containerNumber: 2, commentId: 'c2', containerTitle: 'fix: y' }),
      mk({ id: '3', repo: 'org/b', containerNumber: 7, commentId: 'c3', containerTitle: 'docs' }),
    ];
    const { html } = renderDigest({
      subject: 's',
      comments,
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toContain('org/a');
    expect(html).toContain('org/b');
    expect(html).toContain('feat: x');
    expect(html).toContain('fix: y');
    expect(html).toContain('docs');
    expect(html.indexOf('org/a')).toBeLessThan(html.indexOf('org/b'));
  });

  it('truncates a long body to 280 chars with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const { html } = renderDigest({
      subject: 's',
      comments: [mk({ body: long })],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toMatch(/x{280}/);
    expect(html).not.toMatch(/x{281}/);
    expect(html).toContain('...');
  });

  it('escapes HTML in comment bodies (XSS safety)', () => {
    const { html } = renderDigest({
      subject: 's',
      comments: [mk({ body: '<script>alert(1)</script>' })],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not merge a PR and an issue that share the same number', () => {
    const comments = [
      mk({
        id: '1',
        repo: 'org/a',
        containerType: 'pr',
        containerNumber: 42,
        containerTitle: 'PR forty-two',
        commentId: 'cpr',
      }),
      mk({
        id: '2',
        repo: 'org/a',
        containerType: 'issue',
        containerNumber: 42,
        containerTitle: 'Issue forty-two',
        commentId: 'cissue',
      }),
    ];
    const { html } = renderDigest({
      subject: 's',
      comments,
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toContain('PR forty-two');
    expect(html).toContain('Issue forty-two');
  });

  it('shows matched rules as labels', () => {
    const { html } = renderDigest({
      subject: 's',
      comments: [mk({ matchedRules: ['mentioned', 'assignee'] })],
      generatedAt: '2026-06-01T12:00:00Z',
    });
    expect(html).toContain('mentioned');
    expect(html).toContain('assignee');
  });
});
