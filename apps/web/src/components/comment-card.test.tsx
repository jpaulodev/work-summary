import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { CommentCard } from './comment-card';
import type { CommentRow } from '../lib/types';

afterEach(() => vi.unstubAllGlobals());

function renderCard(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

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
    renderCard(<CommentCard comment={sample()} onStatusChange={() => undefined} />);
    expect(screen.getByText('org/repo')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Mentioned')).toBeInTheDocument();
    expect(screen.getByText('Assignee')).toBeInTheDocument();
  });

  it('calls onStatusChange with addressed when the button is clicked', () => {
    const onChange = vi.fn();
    renderCard(<CommentCard comment={sample()} onStatusChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /addressed/i }));
    expect(onChange).toHaveBeenCalledWith('addressed');
  });

  it('renders a JIRA comment with its issue key and browse link', () => {
    renderCard(
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
    renderCard(<CommentCard comment={sample({ status: 'resolved' })} onStatusChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reopen/i }));
    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('sends a reply through the composer', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return Promise.resolve(
          new Response(JSON.stringify({ reply: { id: 1 }, status: 'addressed' }), { status: 200 }),
        );
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCard(<CommentCard comment={sample()} onStatusChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /reply/i }), {
      target: { value: 'thanks' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/comments/a/reply'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('surfaces a token-write-scope banner on reply failure', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'token-write-scope', message: 'no scope' }), {
            status: 400,
          }),
        );
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderCard(<CommentCard comment={sample()} onStatusChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /reply/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /reply/i }), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/lack write scope/i)).toBeInTheDocument());
  });
});
