import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Runs from './runs';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Runs />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Runs — scan progress', () => {
  it('shows a progress bar with phase and repo count while scanning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/scan/status'))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                running: true,
                progress: { phase: 'github', reposDone: 3, reposTotal: 10, commentsFound: 5 },
              }),
              { status: 200 },
            ),
          );
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/scanning github/i)).toBeInTheDocument());
    expect(screen.getByText('3/10 repos')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '30');
  });

  it('hides the progress bar when no scan is running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/scan/status'))
          return Promise.resolve(new Response(JSON.stringify({ running: false }), { status: 200 }));
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/no runs yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
