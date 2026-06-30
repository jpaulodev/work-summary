import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { JiraDiscoveredProject, JiraProject, JiraSite } from './types';

export function useJiraSites() {
  return useQuery({ queryKey: ['jira-sites'], queryFn: () => api.get<JiraSite[]>('/jira/sites') });
}

export function useCreateJiraSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseUrl: string; email: string; token: string }) =>
      api.post<JiraSite>('/jira/sites', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jira-sites'] }),
  });
}

export function useDeleteJiraSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/jira/sites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jira-sites'] }),
  });
}

export function useJiraProjects(siteId: string) {
  return useQuery({
    queryKey: ['jira-projects', siteId],
    queryFn: () => api.get<JiraProject[]>(`/jira/sites/${siteId}/projects`),
  });
}

export function useDiscoverProjects(siteId: string) {
  return useMutation({
    mutationFn: () => api.get<JiraDiscoveredProject[]>(`/jira/sites/${siteId}/projects/discover`),
  });
}

export function useSaveProjects(siteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projects: { projectKey: string; projectName: string }[]) =>
      api.put<JiraProject[]>(`/jira/sites/${siteId}/projects`, { projects }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jira-projects', siteId] }),
  });
}
