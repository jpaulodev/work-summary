CREATE TABLE jira_site (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  email TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  developer_field_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE jira_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES jira_site(id) ON DELETE CASCADE,
  project_key TEXT NOT NULL,
  project_name TEXT NOT NULL
);
CREATE INDEX idx_jira_project_site ON jira_project(site_id);

ALTER TABLE notified_comments ADD COLUMN issue_key TEXT;
