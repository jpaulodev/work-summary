CREATE TABLE app_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE app_session (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE source_config (
  source TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  token_ciphertext TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE notifier_config (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_nonce TEXT NOT NULL
);

CREATE TABLE comment_status (
  comment_id TEXT PRIMARY KEY REFERENCES notified_comments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  snoozed_until TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_comment_status_status ON comment_status(status);

CREATE TABLE master_secret (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL
);
