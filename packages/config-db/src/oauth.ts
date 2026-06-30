import { encryptSecret, decryptSecret } from '@work-summary/auth';
import {
  OAuthConnectionRepository,
  type OAuthProvider,
  type SqliteDatabase,
} from '@work-summary/storage';

/** Connection metadata safe to return to clients — never includes tokens. */
export interface OAuthConnectionView {
  provider: OAuthProvider;
  accountId: string | null;
  accountLogin: string | null;
  cloudId: string | null;
  siteUrl: string | null;
  scopes: string | null;
  expiresAt: string | null;
  connectedAt: string;
}

/** Decrypted tokens for server-side use (scanning, refreshing, replying). */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  accountId: string | null;
  accountLogin: string | null;
  cloudId: string | null;
  siteUrl: string | null;
  scopes: string | null;
}

export interface SaveOAuthConnection {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  accountId?: string | null;
  accountLogin?: string | null;
  cloudId?: string | null;
  siteUrl?: string | null;
  scopes?: string | null;
}

export interface OAuthConnectionService {
  listViews(userId: number): OAuthConnectionView[];
  getView(userId: number, provider: OAuthProvider): OAuthConnectionView | null;
  getTokens(userId: number, provider: OAuthProvider): OAuthTokens | null;
  save(userId: number, provider: OAuthProvider, conn: SaveOAuthConnection): void;
  delete(userId: number, provider: OAuthProvider): void;
}

export function createOAuthConnectionService(
  db: SqliteDatabase,
  key: Buffer,
  now: () => Date = () => new Date(),
): OAuthConnectionService {
  const repo = new OAuthConnectionRepository(db, now);

  return {
    listViews(userId) {
      return repo.list(userId).map((r) => ({
        provider: r.provider,
        accountId: r.accountId,
        accountLogin: r.accountLogin,
        cloudId: r.cloudId,
        siteUrl: r.siteUrl,
        scopes: r.scopes,
        expiresAt: r.expiresAt,
        connectedAt: r.createdAt,
      }));
    },

    getView(userId, provider) {
      const r = repo.get(userId, provider);
      if (!r) return null;
      return {
        provider: r.provider,
        accountId: r.accountId,
        accountLogin: r.accountLogin,
        cloudId: r.cloudId,
        siteUrl: r.siteUrl,
        scopes: r.scopes,
        expiresAt: r.expiresAt,
        connectedAt: r.createdAt,
      };
    },

    getTokens(userId, provider) {
      const r = repo.get(userId, provider);
      if (!r) return null;
      const accessToken = decryptSecret(r.accessCiphertext, r.accessNonce, key);
      const refreshToken =
        r.refreshCiphertext && r.refreshNonce
          ? decryptSecret(r.refreshCiphertext, r.refreshNonce, key)
          : null;
      return {
        accessToken,
        refreshToken,
        expiresAt: r.expiresAt,
        accountId: r.accountId,
        accountLogin: r.accountLogin,
        cloudId: r.cloudId,
        siteUrl: r.siteUrl,
        scopes: r.scopes,
      };
    },

    save(userId, provider, conn) {
      const access = encryptSecret(conn.accessToken, key);
      const refresh =
        conn.refreshToken != null && conn.refreshToken.length > 0
          ? encryptSecret(conn.refreshToken, key)
          : null;
      repo.upsert(userId, provider, {
        accessCiphertext: access.ciphertext,
        accessNonce: access.nonce,
        refreshCiphertext: refresh?.ciphertext ?? null,
        refreshNonce: refresh?.nonce ?? null,
        expiresAt: conn.expiresAt ?? null,
        accountId: conn.accountId ?? null,
        accountLogin: conn.accountLogin ?? null,
        cloudId: conn.cloudId ?? null,
        siteUrl: conn.siteUrl ?? null,
        scopes: conn.scopes ?? null,
      });
    },

    delete(userId, provider) {
      repo.delete(userId, provider);
    },
  };
}
