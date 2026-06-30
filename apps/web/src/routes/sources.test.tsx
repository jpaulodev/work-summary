import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sources from './sources';
import type { GithubSource } from '../lib/types';

const FULL_RULES = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

function github(over: Partial<GithubSource> = {}): GithubSource {
  return {
    enabled: true,
    repos: ['org/a'],
    rules: FULL_RULES,
    filters: { excludeBots: true, botWhitelist: [] },
    connection: null,
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Sources />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Sources screen — GitHub OAuth', () => {
  it('shows a Connect GitHub link when not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ github: github() }), { status: 200 })),
    );
    renderPage();
    const link = await screen.findByRole('link', { name: /connect github/i });
    expect(link).toHaveAttribute('href', '/api/oauth/github/start');
  });

  it('shows the connected account and a Disconnect button when connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            github: github({ connection: { accountLogin: 'octocat', connectedAt: 'x' } }),
          }),
          { status: 200 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('@octocat')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /connect github/i })).not.toBeInTheDocument();
  });

  it('calls DELETE /oauth/github when disconnecting', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE')
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            github: github({ connection: { accountLogin: 'octocat', connectedAt: 'x' } }),
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/oauth/github'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
