import {
  OAuthError,
  type AuthorizeParams,
  type ExchangeParams,
  type FetchImpl,
  type Identity,
  type Provider,
  type RefreshParams,
  type TokenSet,
} from './types.js';

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const API_BASE = 'https://api.atlassian.com';

interface AtlassianTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface AccessibleResource {
  id: string;
  url: string;
  name: string;
  scopes: string[];
}

function parseTokenResponse(body: AtlassianTokenResponse): TokenSet {
  if (body.error || !body.access_token) {
    throw new OAuthError(
      body.error_description ?? body.error ?? 'no access_token',
      'exchange-failed',
    );
  }
  const token: TokenSet = { accessToken: body.access_token };
  if (body.refresh_token) token.refreshToken = body.refresh_token;
  if (typeof body.expires_in === 'number') token.expiresIn = body.expires_in;
  if (body.scope) token.scopes = body.scope;
  return token;
}

/**
 * JIRA (Atlassian) OAuth 2.0 3LO provider. Tokens are short-lived and rotated
 * via a refresh token (offline_access scope); API calls go through
 * api.atlassian.com/ex/jira/{cloudId} once the accessible resource is resolved.
 */
export const jiraProvider: Provider = {
  defaultScopes: ['read:jira-work', 'read:jira-user', 'write:jira-work', 'offline_access'],

  buildAuthorizeUrl(params: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('scope', (params.scopes ?? this.defaultScopes).join(' '));
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  },

  async exchangeCodeForToken(params: ExchangeParams, fetchImpl: FetchImpl): Promise<TokenSet> {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
      }),
    });
    if (!res.ok) {
      throw new OAuthError(`jira token exchange failed (${res.status})`, 'exchange-failed');
    }
    return parseTokenResponse((await res.json()) as AtlassianTokenResponse);
  },

  async refreshAccessToken(params: RefreshParams, fetchImpl: FetchImpl): Promise<TokenSet> {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: params.clientId,
        client_secret: params.clientSecret,
        refresh_token: params.refreshToken,
      }),
    });
    if (!res.ok) {
      throw new OAuthError(`jira token refresh failed (${res.status})`, 'refresh-failed');
    }
    return parseTokenResponse((await res.json()) as AtlassianTokenResponse);
  },

  async fetchIdentity(accessToken: string, fetchImpl: FetchImpl): Promise<Identity> {
    const res = await fetchImpl(RESOURCES_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      throw new OAuthError(`jira resource lookup failed (${res.status})`, 'identity-failed');
    }
    const resources = (await res.json()) as AccessibleResource[];
    const first = resources[0];
    if (!first) {
      throw new OAuthError('no accessible JIRA site for this account', 'no-resource');
    }

    // Resolve the Atlassian accountId so the scanner can skip the user's own
    // comments. Best-effort: identity still succeeds if this call fails.
    let accountId = '';
    try {
      const meRes = await fetchImpl(`${API_BASE}/ex/jira/${first.id}/rest/api/3/myself`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (meRes.ok) {
        accountId = ((await meRes.json()) as { accountId?: string }).accountId ?? '';
      }
    } catch {
      // ignore — accountId stays empty
    }

    return { accountId, login: first.url, cloudId: first.id, siteUrl: first.url };
  },
};
