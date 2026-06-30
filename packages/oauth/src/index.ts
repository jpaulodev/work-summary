import { githubProvider } from './github.js';
import { jiraProvider } from './jira.js';
import {
  OAuthError,
  type AuthorizeParams,
  type ExchangeParams,
  type FetchImpl,
  type Identity,
  type OAuthProvider,
  type Provider,
  type RefreshParams,
  type TokenSet,
} from './types.js';

export {
  OAuthError,
  type AuthorizeParams,
  type ExchangeParams,
  type FetchImpl,
  type Identity,
  type OAuthProvider,
  type RefreshParams,
  type TokenSet,
};

const PROVIDERS: Record<OAuthProvider, Provider> = {
  github: githubProvider,
  jira: jiraProvider,
};

function resolve(provider: OAuthProvider): Provider {
  const p = PROVIDERS[provider];
  if (!p) throw new OAuthError(`unsupported provider: ${provider}`, 'unsupported-provider');
  return p;
}

export function isSupportedProvider(value: string): value is OAuthProvider {
  return Boolean(PROVIDERS[value as OAuthProvider]);
}

export function defaultScopes(provider: OAuthProvider): string[] {
  return resolve(provider).defaultScopes;
}

export function buildAuthorizeUrl(provider: OAuthProvider, params: AuthorizeParams): string {
  return resolve(provider).buildAuthorizeUrl(params);
}

export function exchangeCodeForToken(
  provider: OAuthProvider,
  params: ExchangeParams,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenSet> {
  return resolve(provider).exchangeCodeForToken(params, fetchImpl);
}

export function fetchIdentity(
  provider: OAuthProvider,
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Identity> {
  return resolve(provider).fetchIdentity(accessToken, fetchImpl);
}

export function refreshAccessToken(
  provider: OAuthProvider,
  params: RefreshParams,
  fetchImpl: FetchImpl = fetch,
): Promise<TokenSet> {
  const p = resolve(provider);
  if (!p.refreshAccessToken) {
    throw new OAuthError(`${provider} does not support token refresh`, 'refresh-unsupported');
  }
  return p.refreshAccessToken(params, fetchImpl);
}
