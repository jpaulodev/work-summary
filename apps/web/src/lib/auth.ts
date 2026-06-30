import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Me {
  username: string;
  role: 'admin' | 'member';
}

export interface InviteItem {
  id: string;
  token: string;
  email: string | null;
  role: 'admin' | 'member';
  createdAt: string;
  expiresAt: string;
  consumedBy: number | null;
  consumedAt: string | null;
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: ['invites'],
    queryFn: () => api.get<{ items: InviteItem[] }>('/invites'),
    enabled,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { role: 'admin' | 'member' }) =>
      api.post<{ id: string; token: string }>('/invites', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useDeleteInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/invites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string; username: string; password: string }) =>
      api.post<{ ok: boolean }>('/auth/register', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: false,
    staleTime: 30_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      api.post<{ ok: boolean }>('/auth/login', creds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}
