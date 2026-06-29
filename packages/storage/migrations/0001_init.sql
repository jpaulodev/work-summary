-- Note: the schema_version table is bootstrapped by the migrator
-- (ensureVersionTable) before any migration runs, so it is intentionally
-- not (re)created here.

CREATE TABLE notified_comments (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  container_type TEXT NOT NULL,
  container_number INTEGER NOT NULL,
  comment_native_id TEXT NOT NULL,
  author_login TEXT NOT NULL,
  matched_rules TEXT NOT NULL,
  notified_at TEXT NOT NULL
);
CREATE INDEX idx_notified_repo ON notified_comments(repo);
CREATE INDEX idx_notified_at ON notified_comments(notified_at);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  comments_found INTEGER DEFAULT 0,
  comments_notified INTEGER DEFAULT 0,
  error_message TEXT,
  source_stats TEXT
);
CREATE INDEX idx_runs_started ON runs(started_at);

CREATE TABLE source_watermarks (
  source TEXT NOT NULL,
  repo TEXT NOT NULL,
  last_success_at TEXT NOT NULL,
  PRIMARY KEY (source, repo)
);
