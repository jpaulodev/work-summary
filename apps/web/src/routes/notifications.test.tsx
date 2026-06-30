import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Notifications from './notifications';
import type { NotifierItem } from '../lib/types';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Notifications />
    </QueryClientProvider>,
  );
}

function item(over: Partial<NotifierItem>): NotifierItem {
  return {
    id: 'n1',
    type: 'slack',
    name: 'team-channel',
    enabled: true,
    host: '',
    port: 587,
    secure: false,
    from: '',
    to: '',
    subjectTemplate: '',
    hasSecret: true,
    ...over,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Notifications screen', () => {
  it('lists notifiers with their type', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ items: [item({})] }), { status: 200 })),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('team-channel')).toBeInTheDocument());
    expect(screen.getByText('Slack')).toBeInTheDocument();
  });

  it('creates a slack notifier via the add dialog', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return Promise.resolve(new Response(JSON.stringify({ id: 'n2' }), { status: 201 }));
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /add notifier/i }));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'slack' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'team-ch' } });
    fireEvent.change(screen.getByLabelText(/webhook url/i), {
      target: { value: 'https://hooks.slack.com/X' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/notifiers'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
