-- Global registry only. User content lives in the per-user UserVault Durable Object.
-- All timestamps are Unix epoch milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                  -- random 128-bit, base32
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'superadmin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'deleting')),
  extra_set_enabled INTEGER NOT NULL DEFAULT 0 CHECK (extra_set_enabled IN (0, 1)),
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  blocked_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,          -- hex SHA-256 of the cookie token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT                          -- JSON, no PII beyond IDs
);
CREATE INDEX idx_admin_audit_at ON admin_audit (at);
