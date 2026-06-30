import type { OAuthProvider } from '@work-summary/oauth';

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/** Base URL used to build redirect URIs and post-callback redirects. */
export function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL;
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : 'http://127.0.0.1:3001';
}

export function redirectUri(provider: OAuthProvider): string {
  return `${publicBaseUrl()}/api/oauth/${provider}/callback`;
}

/**
 * Read a provider's OAuth app credentials from the environment, e.g.
 * GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET. Returns null when either
 * is missing so callers can answer "not configured" instead of crashing.
 */
export function oauthClientCredentials(provider: OAuthProvider): OAuthClientCredentials | null {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
