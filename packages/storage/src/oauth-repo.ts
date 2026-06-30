import type { SqliteDatabase } from './db.js';

export type OAuthProvider = 'github' | 'jira';

export interface OAuthConnectionRow {
  userId: number;
  provider: OAuthProvider;
  accessCiphertext: string;
  accessNonce: string;
  refreshCiphertext: string | null;
  refreshNonce: string | null;
  expiresAt: string | null;
  accountId: string | null;
  accountLogin: string | null;
  cloudId: string | null;
  siteUrl: string | null;
  scopes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Token ciphertext + metadata for an upsert. Tokens are encrypted by the caller. */
export interface OAuthConnectionUpsert {
  accessCiphertext: string;
  accessNonce: string;
  refreshCiphertext?: string | null;
  refreshNonce?: string | null;
  expiresAt?: string | null;
  accountId?: string | null;
  accountLogin?: string | null;
  cloudId?: string | null;
  siteUrl?: string | null;
  scopes?: string | null;
}

interface RawRow {
  user_id: number;
  provider: string;
  access_ciphertext: string;
  access_nonce: string;
  refresh_ciphertext: string | null;
  refresh_nonce: string | null;
  expires_at: string | null;
  account_id: string | null;
  account_login: string | null;
  cloud_id: string | null;
  site_url: string | null;
  scopes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Stores OAuth connections keyed by (user_id, provider). This repository deals in
 * already-encrypted ciphertext only — encryption/decryption happens one layer up
 * (config-db) so the master key never reaches storage.
 */
export class OAuthConnectionRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private parse(r: RawRow): OAuthConnectionRow {
    return {
      userId: r.user_id,
      provider: r.provider as OAuthProvider,
      accessCiphertext: r.access_ciphertext,
      accessNonce: r.access_nonce,
      refreshCiphertext: r.refresh_ciphertext,
      refreshNonce: r.refresh_nonce,
      expiresAt: r.expires_at,
      accountId: r.account_id,
      accountLogin: r.account_login,
      cloudId: r.cloud_id,
      siteUrl: r.site_url,
      scopes: r.scopes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  get(userId: number, provider: OAuthProvider): OAuthConnectionRow | null {
    const r = this.db
      .prepare('SELECT * FROM oauth_connection WHERE user_id = ? AND provider = ?')
      .get(userId, provider) as RawRow | undefined;
    return r ? this.parse(r) : null;
  }

  list(userId: number): OAuthConnectionRow[] {
    return (
      this.db
        .prepare('SELECT * FROM oauth_connection WHERE user_id = ? ORDER BY provider')
        .all(userId) as RawRow[]
    ).map((r) => this.parse(r));
  }

  upsert(
    userId: number,
    provider: OAuthProvider,
    fields: OAuthConnectionUpsert,
  ): OAuthConnectionRow {
    const existing = this.get(userId, provider);
    const nowIso = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO oauth_connection
           (user_id, provider, access_ciphertext, access_nonce, refresh_ciphertext, refresh_nonce,
            expires_at, account_id, account_login, cloud_id, site_url, scopes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET
           access_ciphertext = excluded.access_ciphertext,
           access_nonce = excluded.access_nonce,
           refresh_ciphertext = excluded.refresh_ciphertext,
           refresh_nonce = excluded.refresh_nonce,
           expires_at = excluded.expires_at,
           account_id = excluded.account_id,
           account_login = excluded.account_login,
           cloud_id = excluded.cloud_id,
           site_url = excluded.site_url,
           scopes = excluded.scopes,
           updated_at = excluded.updated_at`,
      )
      .run(
        userId,
        provider,
        fields.accessCiphertext,
        fields.accessNonce,
        fields.refreshCiphertext ?? null,
        fields.refreshNonce ?? null,
        fields.expiresAt ?? null,
        fields.accountId ?? null,
        fields.accountLogin ?? null,
        fields.cloudId ?? null,
        fields.siteUrl ?? null,
        fields.scopes ?? null,
        existing?.createdAt ?? nowIso,
        nowIso,
      );
    return this.get(userId, provider) as OAuthConnectionRow;
  }

  delete(userId: number, provider: OAuthProvider): void {
    this.db
      .prepare('DELETE FROM oauth_connection WHERE user_id = ? AND provider = ?')
      .run(userId, provider);
  }
}
