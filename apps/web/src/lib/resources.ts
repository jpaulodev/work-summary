import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { GithubSource, MatchRules, NotifierItem, RunRow, ScanStatus, Schedule } from './types';

// Sources
export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => api.get<{ github: GithubSource | null }>('/sources'),
  });
}

export function useUpdateSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      enabled?: boolean;
      token?: string;
      repos?: string[];
      rules?: MatchRules;
      filters?: { excludeBots: boolean; botWhitelist: string[] };
    }) => api.put<{ ok: boolean }>('/sources/github', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  });
}

// Notifiers
export function useNotifiers() {
  return useQuery({
    queryKey: ['notifiers'],
    queryFn: () => api.get<{ items: NotifierItem[] }>('/notifiers'),
  });
}

export function useUpdateNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      host?: string;
      port?: number;
      secure?: boolean;
      from?: string;
      to?: string;
      subjectTemplate?: string;
      enabled?: boolean;
      secret?: { user: string; pass: string };
    }) => {
      const { id, ...body } = input;
      return api.put<{ ok: boolean }>(`/notifiers/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifiers'] }),
  });
}

export function useTestNotifier() {
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; error?: string }>(`/notifiers/${id}/test`),
  });
}

export type CreateNotifierInput =
  | {
      type: 'smtp';
      name: string;
      host: string;
      port: number;
      secure: boolean;
      from: string;
      to: string;
      secret: { user: string; pass: string };
    }
  | { type: 'slack' | 'teams'; name: string; webhookUrl: string };

export function useCreateNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNotifierInput) => api.post<{ id: string }>('/notifiers', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifiers'] }),
  });
}

export function useDeleteNotifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/notifiers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifiers'] }),
  });
}

// Runs + scan
export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => api.get<{ items: RunRow[] }>('/runs'),
  });
}

export function useScanStatus() {
  return useQuery({
    queryKey: ['scan-status'],
    queryFn: () => api.get<ScanStatus>('/scan/status'),
    // Keep polling while a scan is running (whoever started it - this tab, another
    // tab, or the CLI), then stop automatically once it finishes.
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
}

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ runId: number }>('/scan'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs'] });
      void qc.invalidateQueries({ queryKey: ['scan-status'] });
    },
  });
}

// Schedules
export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get<Schedule[]>('/schedules'),
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; cronExpression: string; timezone?: string }) =>
      api.post<Schedule>('/schedules', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      enabled?: boolean;
      cronExpression?: string;
      name?: string;
    }) => {
      const { id, ...patch } = input;
      return api.put<Schedule>(`/schedules/${id}`, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}
