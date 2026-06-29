import { createHash } from 'node:crypto';

export interface CommentIdParts {
  source: string;
  repo: string;
  type: string;
  nativeId: string;
}

export function computePendingCommentId(parts: CommentIdParts): string {
  const input = `${parts.source}:${parts.repo}:${parts.type}:${parts.nativeId}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}
