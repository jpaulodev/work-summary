import type { RawComment } from '@work-summary/core';

export function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid repo "${repo}", expected "owner/name"`);
  return { owner, repo: name };
}

export function isBot(login: string, type: string | undefined): boolean {
  return type === 'Bot' || login.endsWith('[bot]');
}

interface ApiComment {
  id: number;
  html_url: string;
  body?: string | null;
  user?: { login?: string; type?: string } | null;
  created_at: string;
}

export function toRawComment(c: ApiComment): RawComment {
  const login = c.user?.login ?? 'ghost';
  return {
    nativeId: String(c.id),
    url: c.html_url,
    author: { login, isBot: isBot(login, c.user?.type) },
    body: c.body ?? '',
    createdAt: c.created_at,
  };
}
