import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface ReplyRow {
  id: number;
  commentId: string;
  body: string;
  sentAt: string;
  source: string;
  sourceResponseId: string | null;
  sourceUrl: string | null;
}

export function useReplies(commentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['replies', commentId],
    queryFn: () => api.get<ReplyRow[]>(`/comments/${commentId}/replies`),
    enabled,
  });
}

export class ReplyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReplyError';
  }
}

export function useSendReply(commentId: string) {
  const qc = useQueryClient();
  return useMutation<{ reply: ReplyRow; status: string }, ReplyError, string>({
    mutationFn: async (body: string) => {
      try {
        return await api.post<{ reply: ReplyRow; status: string }>(`/comments/${commentId}/reply`, {
          body,
        });
      } catch (err) {
        if (err instanceof ApiError) {
          const b = err.body as { error?: string; message?: string } | null;
          throw new ReplyError(b?.error ?? 'error', b?.message ?? 'Reply failed');
        }
        throw new ReplyError('error', 'Reply failed');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['comments'] });
      void qc.invalidateQueries({ queryKey: ['replies', commentId] });
    },
  });
}
