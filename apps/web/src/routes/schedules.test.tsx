import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Schedules from './schedules';
import type { Schedule } from '../lib/types';

function sample(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'morning',
    enabled: true,
    cronExpression: '0 9 * * 1-5',
    timezone: 'UTC',
    reposFilter: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    lastRunAt: null,
    lastRunId: null,
    nextRunAt: null,
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Schedules />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Schedules screen', () => {
  it('lists schedules from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify([sample()]), { status: 200 })),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('morning')).toBeInTheDocument());
    expect(screen.getByText(/0 9 \* \* 1-5/)).toBeInTheDocument();
  });

  it('opens the create dialog and posts a preset schedule', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify(sample({ id: 's2', name: 'weekday-9am' })), { status: 201 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /new schedule/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'weekday-9am' } });
    fireEvent.click(screen.getByRole('button', { name: /every weekday at 9 am/i }));
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/schedules'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
