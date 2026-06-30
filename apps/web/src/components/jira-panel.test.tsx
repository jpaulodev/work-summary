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

  it('lists projects with search filter and saves the checked selection', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/jira/site/projects/discover'))
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { key: 'WS', name: 'Work Summary' },
              { key: 'OPS', name: 'Operations' },
            ]),
            { status: 200 },
          ),
        );
      if (u.endsWith('/jira/site/projects') && init?.method === 'PUT')
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (u.includes('/jira/site/projects'))
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

    await screen.findByText(/Work Summary/);
    expect(screen.getByText(/Operations/)).toBeInTheDocument();

    // Filter narrows the list.
    fireEvent.change(screen.getByRole('textbox', { name: /search projects/i }), {
      target: { value: 'oper' },
    });
    expect(screen.queryByText(/Work Summary/)).not.toBeInTheDocument();
    expect(screen.getByText(/Operations/)).toBeInTheDocument();

    // Check Operations and save -> PUT carries OPS.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /save selection/i }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      expect((put?.[1] as { body: string }).body).toContain('OPS');
    });
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
