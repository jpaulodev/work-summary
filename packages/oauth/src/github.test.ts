import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  refreshAccessToken,
  defaultScopes,
  isSupportedProvider,
  OAuthError,
} from './index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('github provider', () => {
  it('builds an authorize URL with default scopes and state', () => {
    const url = new URL(
      buildAuthorizeUrl('github', {
        clientId: 'cid',
        redirectUri: 'https://app/api/oauth/github/callback',
        state: 'xyz',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/api/oauth/github/callback');
    expect(url.searchParams.get('scope')).toBe('repo read:user');
    expect(url.searchParams.get('state')).toBe('xyz');
  });

  it('exchanges a code for an access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'gho_abc', scope: 'repo,read:user', token_type: 'bearer' }),
      );
    const token = await exchangeCodeForToken(
      'github',
      { clientId: 'cid', clientSecret: 'sec', code: 'code1', redirectUri: 'https://app/cb' },
      fetchMock,
    );
    expect(token.accessToken).toBe('gho_abc');
    expect(token.scopes).toBe('repo,read:user');
    expect(token.refreshToken).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(init.body as string).toContain('code=code1');
  });

  it('throws OAuthError when github returns an error payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'bad_verification_code' }, 200));
    await expect(
      exchangeCodeForToken(
        'github',
        { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'https://app/cb' },
        fetchMock,
      ),
    ).rejects.toBeInstanceOf(OAuthError);
  });

  it('throws OAuthError on a non-2xx exchange', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(
      exchangeCodeForToken(
        'github',
        { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'https://app/cb' },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: 'exchange-failed' });
  });

  it('resolves identity from /user', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 42, login: 'octocat' }));
    const id = await fetchIdentity('github', 'gho_abc', fetchMock);
    expect(id).toEqual({ accountId: '42', login: 'octocat' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gho_abc');
  });

  it('refresh is unsupported for github', () => {
    expect(() =>
      refreshAccessToken('github', { clientId: 'c', clientSecret: 's', refreshToken: 'r' }),
    ).toThrow(/refresh/);
  });

  it('exposes provider metadata', () => {
    expect(defaultScopes('github')).toEqual(['repo', 'read:user']);
    expect(isSupportedProvider('github')).toBe(true);
    expect(isSupportedProvider('bitbucket')).toBe(false);
  });
});
