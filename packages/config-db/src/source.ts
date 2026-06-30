import type { MatchRulesConfig, BotFilterConfig } from '@work-summary/core';
import type { SqliteDatabase } from '@work-summary/storage';

/**
 * GitHub source configuration. The access token is NOT stored here anymore — it
 * comes from the user's OAuth connection (oauth_connection). This holds only the
 * repo list, matching rules, and bot filter.
 */
export interface GithubSourceConfig {
  enabled: boolean;
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

interface ConfigJson {
  repos: string[];
  rules: MatchRulesConfig;
  filters: BotFilterConfig;
}

export interface GithubSourceConfigInput {
  enabled?: boolean | undefined;
  repos?: string[] | undefined;
  rules?: MatchRulesConfig | undefined;
  filters?: BotFilterConfig | undefined;
}

export interface SourceConfigRepo {
  getGithub(): GithubSourceConfig | null;
  putGithub(input: GithubSourceConfigInput): void;
}

const DEFAULT_RULES: MatchRulesConfig = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

const DEFAULT_FILTERS: BotFilterConfig = { excludeBots: true, botWhitelist: [] };

export function createSourceConfigRepo(db: SqliteDatabase, userId: number): SourceConfigRepo {
  const get = db.prepare(
    'SELECT enabled, config_json FROM source_config WHERE user_id = ? AND source = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO source_config (user_id, source, enabled, token_ciphertext, token_nonce, config_json)
     VALUES (?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(user_id, source) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json`,
  );

  const repo: SourceConfigRepo = {
    getGithub() {
      const row = get.get(userId, 'github') as { enabled: number; config_json: string } | undefined;
      if (!row) return null;
      const cj = JSON.parse(row.config_json) as ConfigJson;
      return {
        enabled: Boolean(row.enabled),
        repos: cj.repos,
        rules: cj.rules,
        filters: cj.filters,
      };
    },
    putGithub(input) {
      const existing = repo.getGithub();
      const merged: ConfigJson = {
        repos: input.repos ?? existing?.repos ?? [],
        rules: input.rules ?? existing?.rules ?? DEFAULT_RULES,
        filters: input.filters ?? existing?.filters ?? DEFAULT_FILTERS,
      };
      const enabled = (input.enabled ?? existing?.enabled ?? true) ? 1 : 0;
      upsert.run(userId, 'github', enabled, JSON.stringify(merged));
    },
  };
  return repo;
}
