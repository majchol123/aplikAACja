-- Statistics v2 (PLAN §2.6): daily usage counts per account, sent by its devices. Only
-- numbers (spoken phrases, tapped tiles), never which words, phrases or tiles. Kept for
-- USAGE_LIMITS.retentionDays; an account's rows go with it (cascade) and when it opts out.

-- Copy of Settings.usageStats (the account's vault holds the setting): the Worker checks
-- it before counting without asking the Durable Object.
ALTER TABLE users ADD COLUMN usage_stats INTEGER NOT NULL DEFAULT 1 CHECK (usage_stats IN (0, 1));
-- When the account's last report was accepted: one per USAGE_LIMITS.minIntervalMs, so a
-- client cannot spend the D1 write quota.
ALTER TABLE users ADD COLUMN usage_sent_at INTEGER;

CREATE TABLE usage_daily (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,                    -- YYYY-MM-DD in the device's time zone
  utterances INTEGER NOT NULL DEFAULT 0,
  tiles INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;

-- Retention cleanup and the admin panel's daily totals read by day.
CREATE INDEX idx_usage_daily_day ON usage_daily (day);
