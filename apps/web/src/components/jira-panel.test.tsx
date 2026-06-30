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

  it('detects and saves the Developer custom field', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/jira/site/fields/discover'))
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: 'customfield_200', name: 'Developer', custom: true }]),
            { status: 200 },
          ),
        );
      if (u.includes('/jira/site/projects'))
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (u.endsWith('/jira/site') && init?.method === 'PUT')
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
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
    fireEvent.click(await screen.findByRole('button', { name: /detect fields/i }));
    // The discovered field appears as an option, then selecting it PUTs the id.
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: /Developer \(customfield_200\)/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: /developer field/i }), {
      target: { value: 'customfield_200' },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/jira/site'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ developerFieldId: 'customfield_200' }),
        }),
      ),
    );
  });
});
