import type { FastifyInstance } from 'fastify';
import { refreshAccessToken } from '@work-summary/oauth';
import { createOAuthConnectionService } from '@work-summary/config-db';
import { oauthClientCredentials } from './oauth-config.js';

export interface JiraAccess {
  accessToken: string;
  cloudId: string;
  siteUrl: string;
}

/** Refresh the JIRA access token when it is within this many ms of expiring. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Return a valid JIRA OAuth access token for the user, refreshing it first when
 * it is at/near expiry and persisting the rotated tokens. Returns null when the
 * user has no JIRA connection. If a refresh is needed but client credentials are
 * not configured, the stored (possibly expired) token is returned best-effort.
 */
export async function getValidJiraAccess(
  app: FastifyInstance,
  userId: number,
): Promise<JiraAccess | null> {
  const svc = createOAuthConnectionService(app.db, app.masterKey, app.now);
  const tokens = svc.getTokens(userId, 'jira');
  if (!tokens || !tokens.cloudId) return null;

  const expired =
    tokens.expiresAt !== null &&
    new Date(tokens.expiresAt).getTime() - app.now().getTime() < REFRESH_SKEW_MS;

  if (expired && tokens.refreshToken) {
    const creds = oauthClientCredentials('jira');
    if (creds) {
      try {
        const refreshed = await refreshAccessToken('jira', {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: tokens.refreshToken,
        });
        const expiresAt =
          refreshed.expiresIn != null
            ? new Date(app.now().getTime() + refreshed.expiresIn * 1000).toISOString()
            : null;
        svc.save(userId, 'jira', {
          accessToken: refreshed.accessToken,
          // Atlassian rotates refresh tokens; keep the new one, falling back to the old.
          refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
          expiresAt,
          accountId: tokens.accountId,
          accountLogin: tokens.accountLogin,
          cloudId: tokens.cloudId,
          siteUrl: tokens.siteUrl,
          scopes: refreshed.scopes ?? tokens.scopes,
        });
        return {
          accessToken: refreshed.accessToken,
          cloudId: tokens.cloudId,
          siteUrl: tokens.siteUrl ?? '',
        };
      } catch (err) {
        // A revoked/expired refresh token must not crash the scan or a request.
        // Fall through to the stale token (best-effort); the downstream JIRA call
        // will surface a 401 that callers already handle (scan is best-effort,
        // reply -> 502). The user reconnects JIRA to recover.
        app.log.warn({ err }, 'jira token refresh failed; using stale access token');
      }
    }
  }

  return {
    accessToken: tokens.accessToken,
    cloudId: tokens.cloudId,
    siteUrl: tokens.siteUrl ?? '',
  };
}
