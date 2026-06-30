import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { JiraDiscoveredProject, JiraProject, JiraSiteStatus } from './types';

export function useJiraSite() {
  return useQuery({
    queryKey: ['jira-site'],
    queryFn: () => api.get<JiraSiteStatus>('/jira/site'),
  });
}

export function useUpdateJiraSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { developerFieldId?: string | null; enabled?: boolean }) =>
      api.put<unknown>('/jira/site', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jira-site'] }),
  });
}

export function useDisconnectJira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<void>('/jira/site'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jira-site'] });
      void qc.invalidateQueries({ queryKey: ['jira-projects'] });
    },
  });
}

export function useJiraProjects(connected: boolean) {
  return useQuery({
    queryKey: ['jira-projects'],
    queryFn: () => api.get<JiraProject[]>('/jira/site/projects'),
    enabled: connected,
  });
}

export function useDiscoverableProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['jira-projects-discover'],
    queryFn: () => api.get<JiraDiscoveredProject[]>('/jira/site/projects/discover'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
}

export function useDiscoverFields() {
  return useMutation({
    mutationFn: () => api.get<JiraField[]>('/jira/site/fields/discover'),
  });
}

export function useSaveProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projects: { projectKey: string; projectName: string }[]) =>
      api.put<JiraProject[]>('/jira/site/projects', { projects }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jira-projects'] }),
  });
}
