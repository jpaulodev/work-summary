CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  repos_filter TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_id INTEGER,
  next_run_at TEXT
);
CREATE INDEX idx_schedules_enabled ON schedules(enabled);

ALTER TABLE runs ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'manual';
