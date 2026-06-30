import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Team from './team';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Team />
    </QueryClientProvider>,
  );
}

function route(url: string, init?: RequestInit): Response | null {
  const u = String(url);
  if (u.includes('/auth/me'))
    return new Response(JSON.stringify({ username: 'admin', role: 'admin' }), { status: 200 });
  if (u.includes('/invites') && init?.method === 'POST')
    return new Response(JSON.stringify({ id: 'i1', token: 'tok-123' }), { status: 201 });
  if (u.includes('/invites')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
  return null;
}

afterEach(() => vi.unstubAllGlobals());

describe('Team screen', () => {
  it('creates an invite via POST /invites', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => Promise.resolve(route(url, init)));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /create invite/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/invites'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('shows admins-only for a member', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ username: 'bob', role: 'member' }), { status: 200 }),
        ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/admins only/i)).toBeInTheDocument());
  });
});
