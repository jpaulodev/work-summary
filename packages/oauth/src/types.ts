export type OAuthProvider = 'github' | 'jira';

export type FetchImpl = typeof fetch;

/** Result of a token exchange or refresh. expiresIn is in seconds. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string;
}

/** Account identity resolved from the provider after a successful exchange. */
export interface Identity {
  accountId: string;
  login: string;
  /** JIRA only: the Atlassian cloud id and site URL for the chosen resource. */
  cloudId?: string;
  siteUrl?: string;
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Overrides the provider default scopes when set. */
  scopes?: string[];
}

export interface ExchangeParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface RefreshParams {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Thrown on any provider-side OAuth failure. Never carries token material. */
export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface Provider {
  readonly defaultScopes: string[];
  buildAuthorizeUrl(params: AuthorizeParams): string;
  exchangeCodeForToken(params: ExchangeParams, fetchImpl: FetchImpl): Promise<TokenSet>;
  fetchIdentity(accessToken: string, fetchImpl: FetchImpl): Promise<Identity>;
  refreshAccessToken?(params: RefreshParams, fetchImpl: FetchImpl): Promise<TokenSet>;
}
