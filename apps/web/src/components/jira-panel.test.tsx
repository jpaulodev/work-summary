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
  it('lists connected sites', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: 's1',
              baseUrl: 'https://acme.atlassian.net',
              email: 'me@x.com',
              developerFieldId: null,
              enabled: true,
              hasToken: true,
            },
          ]),
          { status: 200 },
        ),
      ),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('acme.atlassian.net')).toBeInTheDocument());
    expect(screen.getByText('me@x.com')).toBeInTheDocument();
  });

  it('posts a new site through the add dialog', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 's2', hasToken: true }), { status: 201 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add jira site/i }));
    fireEvent.change(screen.getByLabelText(/base url/i), {
      target: { value: 'https://acme.atlassian.net' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'me@x.com' } });
    fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: 'tok12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/jira/sites'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
