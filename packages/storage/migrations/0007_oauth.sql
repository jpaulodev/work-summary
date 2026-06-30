-- Phase 7a: OAuth connections replace pasted source tokens.
-- One row per (user_id, provider). Multi-user-ready from the start: existing
-- single-user installs use user_id = 1 (the admin once Phase 7c lands).
CREATE TABLE oauth_connection (
  user_id            INTEGER NOT NULL,
  provider           TEXT    NOT NULL,           -- 'github' | 'jira'
  access_ciphertext  TEXT    NOT NULL,
  access_nonce       TEXT    NOT NULL,
  refresh_ciphertext TEXT,                        -- null for non-expiring (github)
  refresh_nonce      TEXT,
  expires_at         TEXT,                         -- ISO; null = never expires
  account_id         TEXT,                         -- github numeric id / jira accountId
  account_login      TEXT,                         -- github login / jira email
  cloud_id           TEXT,                         -- jira only
  site_url           TEXT,                         -- jira only
  scopes             TEXT,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- GitHub no longer stores a pasted token in source_config; the access token
-- comes from oauth_connection. Rebuild the table to make the token columns
-- nullable (SQLite cannot drop NOT NULL in place).
CREATE TABLE source_config_new (
  source           TEXT PRIMARY KEY,
  enabled          INTEGER NOT NULL DEFAULT 1,
  token_ciphertext TEXT,
  token_nonce      TEXT,
  config_json      TEXT NOT NULL
);
INSERT INTO source_config_new (source, enabled, token_ciphertext, token_nonce, config_json)
  SELECT source, enabled, token_ciphertext, token_nonce, config_json FROM source_config;
DROP TABLE source_config;
ALTER TABLE source_config_new RENAME TO source_config;
