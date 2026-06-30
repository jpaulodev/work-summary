import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommentCard } from './comment-card';
import type { CommentRow } from '../lib/types';

function sample(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'a',
    source: 'github',
    repo: 'org/repo',
    containerType: 'pr',
    containerNumber: 7,
    commentId: 'c1',
    author: 'alice',
    matchedRules: ['mentioned', 'assignee'],
    notifiedAt: new Date().toISOString(),
    status: 'pending',
    note: null,
    snoozedUntil: null,
    issueKey: null,
    ...overrides,
  };
}

describe('CommentCard', () => {
  it('renders repo, author, container and rule labels', () => {
    render(<CommentCard comment={sample()} onStatusChange={() => undefined} />);
    expect(screen.getByText('org/repo')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Mentioned')).toBeInTheDocument();
    expect(screen.getByText('Assignee')).toBeInTheDocument();
  });

  it('calls onStatusChange with addressed when the button is clicked', () => {
    const onChange = vi.fn();
    render(<CommentCard comment={sample()} onStatusChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /addressed/i }));
    expect(onChange).toHaveBeenCalledWith('addressed');
  });

  it('renders a JIRA comment with its issue key and browse link', () => {
    render(
      <CommentCard
        comment={sample({
          source: 'jira',
          repo: 'https://acme.atlassian.net :: WS',
          issueKey: 'WS-12',
        })}
        onStatusChange={() => undefined}
      />,
    );
    const link = screen.getByText('WS-12').closest('a');
    expect(link).toHaveAttribute('href', 'https://acme.atlassian.net/browse/WS-12');
  });

  it('shows a reopen action for non-pending comments', () => {
    const onChange = vi.fn();
    render(<CommentCard comment={sample({ status: 'resolved' })} onStatusChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reopen/i }));
    expect(onChange).toHaveBeenCalledWith('pending');
  });
});
