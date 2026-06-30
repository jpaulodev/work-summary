import { encryptSecret, decryptSecret } from '@work-summary/auth';
import type { MatchRulesConfig, BotFilterConfig } from '@work-summary/core';
import type { SqliteDatabase } from '@work-summary/storage';

export interface GithubSourceConfig {
  enabled: boolean;
  token: string;
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

interface ConfigJson {
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

export interface SourceConfigRepo {
  getGithub(): GithubSourceConfig | null;
  putGithub(input: Partial<GithubSourceConfig>): void;
}

const DEFAULT_RULES: MatchRulesConfig = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

const DEFAULT_FILTERS: BotFilterConfig = { excludeBots: true, botWhitelist: [] };

export function createSourceConfigRepo(db: SqliteDatabase, key: Buffer): SourceConfigRepo {
  const get = db.prepare(
    'SELECT enabled, token_ciphertext, token_nonce, config_json FROM source_config WHERE source = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO source_config (source, enabled, token_ciphertext, token_nonce, config_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET enabled = excluded.enabled, token_ciphertext = excluded.token_ciphertext,
       token_nonce = excluded.token_nonce, config_json = excluded.config_json`,
  );

  const repo: SourceConfigRepo = {
    getGithub() {
      const row = get.get('github') as
        | { enabled: number; token_ciphertext: string; token_nonce: string; config_json: string }
        | undefined;
      if (!row) return null;
      const cj = JSON.parse(row.config_json) as ConfigJson;
      return {
        enabled: Boolean(row.enabled),
        token: decryptSecret(row.token_ciphertext, row.token_nonce, key),
        repos: cj.repos,
        rules: cj.rules,
        filters: cj.filters,
      };
    },
    putGithub(input) {
      const existing = repo.getGithub();
      const token = input.token ?? existing?.token;
      if (!token) throw new Error('token required on first put');
      const merged: ConfigJson = {
        repos: input.repos ?? existing?.repos ?? [],
        rules: input.rules ?? existing?.rules ?? DEFAULT_RULES,
        filters: input.filters ?? existing?.filters ?? DEFAULT_FILTERS,
      };
      const enc = encryptSecret(token, key);
      const enabled = (input.enabled ?? existing?.enabled ?? true) ? 1 : 0;
      upsert.run('github', enabled, enc.ciphertext, enc.nonce, JSON.stringify(merged));
    },
  };
  return repo;
}
