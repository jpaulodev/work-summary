-- Phase 7c: multi-user. Every per-user table gains a user_id; existing rows
-- belong to the bootstrap admin (user 1). app_user gains roles + invites.
--
-- Ordering matters: comment_status and jira_project both have ON DELETE CASCADE
-- foreign keys, and foreign_keys=ON cannot be toggled inside the migration
-- transaction. So each child table is fully rebuilt (copied into a FK-free /
-- re-keyed _new table) BEFORE its parent is dropped, otherwise dropping the
-- parent would cascade-delete the child rows we are trying to preserve.

-- --- app_user: drop the single-user CHECK(id=1), add role + email -------------
CREATE TABLE app_user_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  email         TEXT,
  created_at    TEXT NOT NULL
);
INSERT INTO app_user_new (id, username, password_hash, role, created_at)
  SELECT id, username, password_hash, 'admin', created_at FROM app_user;
DROP TABLE app_user;
ALTER TABLE app_user_new RENAME TO app_user;

-- --- invites ------------------------------------------------------------------
CREATE TABLE invite (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'member',
  created_by  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  consumed_by INTEGER,
  consumed_at TEXT
);

-- --- source_config: PK becomes (user_id, source) ------------------------------
CREATE TABLE source_config_new (
  user_id          INTEGER NOT NULL DEFAULT 1,
  source           TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  token_ciphertext TEXT,
  token_nonce      TEXT,
  config_json      TEXT NOT NULL,
  PRIMARY KEY (user_id, source)
);
INSERT INTO source_config_new (user_id, source, enabled, token_ciphertext, token_nonce, config_json)
  SELECT 1, source, enabled, token_ciphertext, token_nonce, config_json FROM source_config;
DROP TABLE source_config;
ALTER TABLE source_config_new RENAME TO source_config;

-- --- source_watermarks: PK becomes (user_id, source, repo) --------------------
CREATE TABLE source_watermarks_new (
  user_id         INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,
  repo            TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source, repo)
);
INSERT INTO source_watermarks_new (user_id, source, repo, last_success_at)
  SELECT 1, source, repo, last_success_at FROM source_watermarks;
DROP TABLE source_watermarks;
ALTER TABLE source_watermarks_new RENAME TO source_watermarks;

-- --- comment_status: re-key to (user_id, comment_id) BEFORE the notified_comments
-- drop below, because its CASCADE FK would otherwise empty it. The new table has
-- no FK, so it survives the later parent rebuild.
CREATE TABLE comment_status_new (
  user_id       INTEGER NOT NULL DEFAULT 1,
  comment_id    TEXT NOT NULL,
  status        TEXT NOT NULL,
  snoozed_until TEXT,
  note          TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);
INSERT INTO comment_status_new (user_id, comment_id, status, snoozed_until, note, updated_at)
  SELECT 1, comment_id, status, snoozed_until, note, updated_at FROM comment_status;
DROP TABLE comment_status;
ALTER TABLE comment_status_new RENAME TO comment_status;

-- --- notified_comments + comment_reply: rebuild together to add user_id -------
-- notified_comments PK becomes (user_id, id) so the same upstream comment can be
-- tracked independently per user. comment_reply keeps its cascade via a composite
-- FK. Rebuild children-first so dropping the parent triggers no cascade delete.
CREATE TABLE notified_comments_new (
  user_id           INTEGER NOT NULL DEFAULT 1,
  id                TEXT NOT NULL,
  source            TEXT NOT NULL,
  repo              TEXT NOT NULL,
  container_type    TEXT NOT NULL,
  container_number  INTEGER NOT NULL,
  comment_native_id TEXT NOT NULL,
  author_login      TEXT NOT NULL,
  matched_rules     TEXT NOT NULL,
  notified_at       TEXT NOT NULL,
  issue_key         TEXT,
  comment_url       TEXT,
  PRIMARY KEY (user_id, id)
);
INSERT INTO notified_comments_new
  (user_id, id, source, repo, container_type, container_number, comment_native_id,
   author_login, matched_rules, notified_at, issue_key, comment_url)
  SELECT 1, id, source, repo, container_type, container_number, comment_native_id,
         author_login, matched_rules, notified_at, issue_key, comment_url
  FROM notified_comments;

CREATE TABLE comment_reply_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL DEFAULT 1,
  comment_id         TEXT NOT NULL,
  body               TEXT NOT NULL,
  sent_at            TEXT NOT NULL,
  source             TEXT NOT NULL,
  source_response_id TEXT,
  source_url         TEXT,
  FOREIGN KEY (user_id, comment_id) REFERENCES notified_comments_new(user_id, id) ON DELETE CASCADE
);
INSERT INTO comment_reply_new
  (id, user_id, comment_id, body, sent_at, source, source_response_id, source_url)
  SELECT id, 1, comment_id, body, sent_at, source, source_response_id, source_url
  FROM comment_reply;

DROP TABLE comment_reply;
DROP TABLE notified_comments;
ALTER TABLE notified_comments_new RENAME TO notified_comments;
ALTER TABLE comment_reply_new RENAME TO comment_reply;
CREATE INDEX idx_notified_repo ON notified_comments(repo);
CREATE INDEX idx_notified_at ON notified_comments(notified_at);
CREATE INDEX idx_comment_reply_comment ON comment_reply(user_id, comment_id);

-- --- jira_site + jira_project: rebuild together for per-user scoping ----------
-- jira_site.id is the Atlassian cloud id, which is shared across users in the
-- same org, so the PK must become (user_id, id). Projects gain user_id and a
-- composite FK. The legacy email/encrypted_token/token_nonce columns (unused
-- since Phase 7b OAuth) are dropped here. Children-first to avoid the cascade.
CREATE TABLE jira_site_new (
  user_id            INTEGER NOT NULL DEFAULT 1,
  id                 TEXT NOT NULL,
  base_url           TEXT NOT NULL,
  cloud_id           TEXT,
  developer_field_id TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
INSERT INTO jira_site_new
  (user_id, id, base_url, cloud_id, developer_field_id, enabled, created_at, updated_at)
  SELECT 1, id, base_url, cloud_id, developer_field_id, enabled, created_at, updated_at
  FROM jira_site;

CREATE TABLE jira_project_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL DEFAULT 1,
  site_id      TEXT NOT NULL,
  project_key  TEXT NOT NULL,
  project_name TEXT NOT NULL,
  FOREIGN KEY (user_id, site_id) REFERENCES jira_site_new(user_id, id) ON DELETE CASCADE
);
INSERT INTO jira_project_new (id, user_id, site_id, project_key, project_name)
  SELECT id, 1, site_id, project_key, project_name FROM jira_project;

DROP TABLE jira_project;
DROP TABLE jira_site;
ALTER TABLE jira_site_new RENAME TO jira_site;
ALTER TABLE jira_project_new RENAME TO jira_project;
CREATE INDEX idx_jira_project_site ON jira_project(user_id, site_id);

-- --- notifier_config: PK becomes (user_id, id) -------------------------------
CREATE TABLE notifier_config_new (
  id                TEXT NOT NULL,
  user_id           INTEGER NOT NULL DEFAULT 1,
  type              TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  config_json       TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_nonce      TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
INSERT INTO notifier_config_new
  (id, user_id, type, enabled, config_json, secret_ciphertext, secret_nonce)
  SELECT id, 1, type, enabled, config_json, secret_ciphertext, secret_nonce FROM notifier_config;
DROP TABLE notifier_config;
ALTER TABLE notifier_config_new RENAME TO notifier_config;

-- --- simple user_id columns (default to the admin) ----------------------------
ALTER TABLE runs ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE schedules ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
