import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { GithubSource, MatchRules, NotifierItem, RunRow, ScanStatus } from './types';

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
    mutationFn: (id: string) => api.post<{ ok: boolean }>(`/notifiers/${id}/test`),
  });
}

// Runs + scan
export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => api.get<{ items: RunRow[] }>('/runs'),
  });
}

export function useScanStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['scan-status'],
    queryFn: () => api.get<ScanStatus>('/scan/status'),
    refetchInterval: enabled ? 2000 : false,
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
