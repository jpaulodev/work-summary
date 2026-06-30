import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JiraPanel } from './jira-panel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <JiraPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('JiraPanel', () => {
  it('shows a Connect JIRA link when not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ connected: false }), { status: 200 })),
    );
    renderPanel();
    const link = await screen.findByRole('link', { name: /connect jira/i });
    expect(link).toHaveAttribute('href', '/api/oauth/jira/start');
  });

  it('shows the connected site host + Disconnect when connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/jira/site/projects'))
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              connected: true,
              site: {
                id: 'cloud-1',
                baseUrl: 'https://acme.atlassian.net',
                developerFieldId: null,
                enabled: true,
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('acme.atlassian.net')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('calls DELETE /jira/site when disconnecting', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      if (String(url).includes('/jira/site/projects'))
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            connected: true,
            site: {
              id: 'cloud-1',
              baseUrl: 'https://acme.atlassian.net',
              developerFieldId: null,
              enabled: true,
            },
          }),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/jira/site'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
