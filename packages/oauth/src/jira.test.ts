import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchIdentity,
  defaultScopes,
  isSupportedProvider,
  OAuthError,
} from './index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('jira provider', () => {
  it('builds an Atlassian authorize URL with audience + offline_access', () => {
    const url = new URL(
      buildAuthorizeUrl('jira', {
        clientId: 'cid',
        redirectUri: 'https://app/api/oauth/jira/callback',
        state: 's1',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('offline_access');
    expect(url.searchParams.get('state')).toBe('s1');
  });

  it('exchanges a code for access + refresh + expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'read:jira-work',
      }),
    );
    const token = await exchangeCodeForToken(
      'jira',
      { clientId: 'c', clientSecret: 's', code: 'x', redirectUri: 'https://app/cb' },
      fetchMock,
    );
    expect(token).toMatchObject({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.atlassian.com/oauth/token');
    expect(JSON.parse(init.body as string)).toMatchObject({ grant_type: 'authorization_code' });
  });

  it('refreshes the access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }),
      );
    const token = await refreshAccessToken(
      'jira',
      { clientId: 'c', clientSecret: 's', refreshToken: 'rt' },
      fetchMock,
    );
    expect(token.accessToken).toBe('at2');
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)).toMatchObject({
      grant_type: 'refresh_token',
    });
  });

  it('resolves identity from accessible-resources + myself', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('accessible-resources')) {
        return Promise.resolve(
          jsonResponse([
            { id: 'cloud-1', url: 'https://acme.atlassian.net', name: 'Acme', scopes: [] },
          ]),
        );
      }
      return Promise.resolve(jsonResponse({ accountId: 'acc-9' }));
    });
    const id = await fetchIdentity('jira', 'at', fetchMock);
    expect(id).toMatchObject({
      accountId: 'acc-9',
      cloudId: 'cloud-1',
      siteUrl: 'https://acme.atlassian.net',
    });
  });

  it('throws when the account has no accessible JIRA site', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    await expect(fetchIdentity('jira', 'at', fetchMock)).rejects.toBeInstanceOf(OAuthError);
  });

  it('is a supported provider with the expected scopes', () => {
    expect(isSupportedProvider('jira')).toBe(true);
    expect(defaultScopes('jira')).toContain('write:jira-work');
  });
});
