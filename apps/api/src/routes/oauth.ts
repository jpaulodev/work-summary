import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { signSessionId, verifySessionId } from '@work-summary/auth';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchIdentity,
  isSupportedProvider,
  type OAuthProvider,
} from '@work-summary/oauth';
import { createOAuthConnectionService } from '@work-summary/config-db';
import { authed } from '../plugins/auth-guard.js';
import { oauthClientCredentials, publicBaseUrl, redirectUri } from '../oauth-config.js';

const STATE_COOKIE = 'ws_oauth_state';

function sourcesRedirect(reply: FastifyReply, query: string): FastifyReply {
  return reply.redirect(`${publicBaseUrl()}/sources?${query}`);
}

function parseProvider(value: unknown): OAuthProvider | null {
  return typeof value === 'string' && isSupportedProvider(value) ? value : null;
}

export default function oauthRoutes(app: FastifyInstance, _opts: unknown, done: () => void): void {
  app.get(
    '/oauth/:provider/start',
    authed((req, reply) => {
      const provider = parseProvider((req.params as { provider?: string }).provider);
      if (!provider) return reply.code(404).send({ error: 'unknown-provider' });
      const creds = oauthClientCredentials(provider);
      if (!creds) return reply.code(501).send({ error: 'oauth-not-configured' });

      const state = randomBytes(16).toString('hex');
      void reply.setCookie(STATE_COOKIE, signSessionId(`${provider}:${state}`, app.sessionSecret), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 600,
        path: '/',
      });
      return reply.redirect(
        buildAuthorizeUrl(provider, {
          clientId: creds.clientId,
          redirectUri: redirectUri(provider),
          state,
        }),
      );
    }),
  );

  app.get(
    '/oauth/:provider/callback',
    authed(async (req, reply) => {
      const provider = parseProvider((req.params as { provider?: string }).provider);
      if (!provider) return reply.code(404).send({ error: 'unknown-provider' });

      const query = z
        .object({ code: z.string().optional(), state: z.string().optional() })
        .parse(req.query);

      // CSRF: the state in the signed cookie must match the one GitHub echoed back.
      const cookie = req.cookies[STATE_COOKIE];
      void reply.clearCookie(STATE_COOKIE, { path: '/' });
      const signed = cookie ? verifySessionId(cookie, app.sessionSecret) : null;
      if (!signed || !query.state || signed !== `${provider}:${query.state}`) {
        return sourcesRedirect(reply, 'oauth_error=state');
      }
      if (!query.code) return sourcesRedirect(reply, 'oauth_error=denied');

      const creds = oauthClientCredentials(provider);
      if (!creds) return reply.code(501).send({ error: 'oauth-not-configured' });

      try {
        const tokens = await exchangeCodeForToken(provider, {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          code: query.code,
          redirectUri: redirectUri(provider),
        });
        const identity = await fetchIdentity(provider, tokens.accessToken);
        const expiresAt =
          tokens.expiresIn != null
            ? new Date(app.now().getTime() + tokens.expiresIn * 1000).toISOString()
            : null;
        createOAuthConnectionService(app.db, app.masterKey, app.now).save(
          req.userId as number,
          provider,
          {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? null,
            expiresAt,
            accountId: identity.accountId,
            accountLogin: identity.login,
            cloudId: identity.cloudId ?? null,
            siteUrl: identity.siteUrl ?? null,
            scopes: tokens.scopes ?? null,
          },
        );
        return sourcesRedirect(reply, `connected=${provider}`);
      } catch {
        return sourcesRedirect(reply, 'oauth_error=exchange');
      }
    }),
  );

  app.get(
    '/oauth/connections',
    authed((req) =>
      createOAuthConnectionService(app.db, app.masterKey).listViews(req.userId as number),
    ),
  );

  app.delete(
    '/oauth/:provider',
    authed((req, reply) => {
      const provider = parseProvider((req.params as { provider?: string }).provider);
      if (!provider) return reply.code(404).send({ error: 'unknown-provider' });
      createOAuthConnectionService(app.db, app.masterKey).delete(req.userId as number, provider);
      return { ok: true };
    }),
  );

  done();
}
