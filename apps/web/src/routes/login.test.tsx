import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Login from './login';

function renderLogin() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits credentials to the login endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/api/auth/login'))
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      if (String(url).endsWith('/api/auth/me'))
        return Promise.resolve(new Response(JSON.stringify({ username: 'me' }), { status: 200 }));
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'me' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw1234567' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/login'),
        expect.any(Object),
      ),
    );
  });

  it('shows an error message on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'invalid' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    renderLogin();
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'me' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument());
  });
});
