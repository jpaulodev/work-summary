import {
  OAuthError,
  type AuthorizeParams,
  type ExchangeParams,
  type FetchImpl,
  type Identity,
  type Provider,
  type TokenSet,
} from './types.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const USER_AGENT = 'work-summary/0.1.0';

interface GithubTokenResponse {
  access_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
}

/**
 * GitHub OAuth App provider. User access tokens do not expire by default, so no
 * refresh token is issued and refreshAccessToken is intentionally absent.
 */
export const githubProvider: Provider = {
  defaultScopes: ['repo', 'read:user'],

  buildAuthorizeUrl(params: AuthorizeParams): string {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', (params.scopes ?? this.defaultScopes).join(' '));
    url.searchParams.set('state', params.state);
    return url.toString();
  },

  async exchangeCodeForToken(params: ExchangeParams, fetchImpl: FetchImpl): Promise<TokenSet> {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
      }).toString(),
    });
    if (!res.ok) {
      throw new OAuthError(`github token exchange failed (${res.status})`, 'exchange-failed');
    }
    const body = (await res.json()) as GithubTokenResponse;
    if (body.error || !body.access_token) {
      throw new OAuthError(
        body.error_description ?? body.error ?? 'no access_token',
        'exchange-failed',
      );
    }
    const token: TokenSet = { accessToken: body.access_token };
    if (body.scope) token.scopes = body.scope;
    return token;
  },

  async fetchIdentity(accessToken: string, fetchImpl: FetchImpl): Promise<Identity> {
    const res = await fetchImpl(USER_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/vnd.github+json',
        'user-agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new OAuthError(`github identity lookup failed (${res.status})`, 'identity-failed');
    }
    const user = (await res.json()) as GithubUserResponse;
    return { accountId: String(user.id), login: user.login };
  },
};
