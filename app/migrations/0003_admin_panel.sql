-- Admin panel and statistics v1 (F4, PLAN §2.6). Copies of the counters every vault keeps
-- in vault_meta, written by the Worker after board/photo writes and tree reads (only when
-- they changed), so the account list needs no request to every Durable Object. They are
-- figures the server already has; nothing new is collected. storage_bytes (0001) is the
-- media byte count of the same copy.

ALTER TABLE users ADD COLUMN boards_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN tiles_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN media_count INTEGER NOT NULL DEFAULT 0;

-- History of one account in the admin panel, newest first by rowid (which every index
-- entry carries, so the index alone gives that order).
CREATE INDEX idx_admin_audit_target ON admin_audit (target_user_id);
