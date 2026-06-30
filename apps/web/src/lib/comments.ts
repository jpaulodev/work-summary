import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { CommentsPage, CommentStatus } from './types';

export interface CommentFilters {
  status?: CommentStatus | 'all';
  repo?: string;
  rule?: string;
  author?: string;
}

function toQuery(filters: CommentFilters, cursor?: string): string {
  const p = new URLSearchParams();
  if (filters.status && filters.status !== 'all') p.set('status', filters.status);
  if (filters.repo) p.set('repo', filters.repo);
  if (filters.rule) p.set('rule', filters.rule);
  if (filters.author) p.set('author', filters.author);
  if (cursor) p.set('cursor', cursor);
  p.set('limit', '50');
  return p.toString();
}

export function useComments(filters: CommentFilters) {
  return useInfiniteQuery({
    queryKey: ['comments', filters],
    queryFn: ({ pageParam }) =>
      api.get<CommentsPage>(`/comments?${toQuery(filters, pageParam ?? undefined)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      status: CommentStatus;
      snoozedUntil?: string;
      note?: string;
    }) => {
      const { id, ...body } = input;
      return api.post<{ ok: boolean }>(`/comments/${id}/status`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments'] }),
  });
}
