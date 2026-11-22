-- Sharing boards by e-mail address (F6, PLAN §2.8): finding the recipient's account.
-- Google addresses are lowercase in practice; the lookup ignores case anyway.

CREATE INDEX idx_users_email ON users (email COLLATE NOCASE);
