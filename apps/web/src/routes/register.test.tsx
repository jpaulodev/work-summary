import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Register from './register';

function renderRegister() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Register', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('signs up with only username + password (no invite token)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/api/auth/register'))
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 201 }));
      return Promise.resolve(new Response(JSON.stringify({ username: 'me' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderRegister();
    // No invite-token field exists anymore.
    expect(screen.queryByLabelText(/invite token/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw1234567' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/auth/register'));
      expect(call).toBeTruthy();
      expect((call?.[1] as { body: string }).body).toBe(
        JSON.stringify({ username: 'alice', password: 'pw1234567' }),
      );
    });
  });

  it('shows a clear error when signups are disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'registration-disabled' }), { status: 403 }),
        ),
    );
    renderRegister();
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw1234567' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByText(/signups are disabled/i)).toBeInTheDocument());
  });
});
