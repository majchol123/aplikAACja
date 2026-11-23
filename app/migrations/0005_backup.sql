-- Encrypted backups (F7, PLAN §6): the age recipient (public key) every file of a backup
-- is encrypted for, and the SHA-256 of the token the backup job presents. One row:
-- setting a new recipient replaces the token; deleting the row turns backups off.
CREATE TABLE backup_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  recipient TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  last_used_at INTEGER
);
