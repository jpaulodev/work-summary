CREATE TABLE comment_reply (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id TEXT NOT NULL REFERENCES notified_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_response_id TEXT,
  source_url TEXT
);
CREATE INDEX idx_comment_reply_comment ON comment_reply(comment_id);

ALTER TABLE source_config ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jira_site ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;

-- Store the canonical comment URL so replies can target the right upstream endpoint.
ALTER TABLE notified_comments ADD COLUMN comment_url TEXT;
