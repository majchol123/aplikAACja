import type { AccountStatus, Role } from '@aplikaacja/shared';
import { newToken, sha256Hex } from '../lib/crypto.ts';

export const SESSION_COOKIE = '__Host-aplikaacja_sid';
export const SESSION_IDLE_MS = 90 * 24 * 3600 * 1000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 3600 * 1000;
/** last_seen_at is refreshed at most this often, to keep D1 writes low. */
export const SESSION_TOUCH_MS = 3600 * 1000;

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: AccountStatus;
  extraSet: boolean;
  tokenHash: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function createSession(db: D1Database, userId: string, now: number): Promise<string> {
  const token = newToken();
  await db
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?3, ?4)',
    )
    .bind(await sha256Hex(token), userId, now, now + SESSION_ABSOLUTE_MS)
    .run();
  return token;
}

interface SessionJoinRow {
  token_hash: string;
  user_id: string;
  last_seen_at: number;
  expires_at: number;
  email: string;
  display_name: string | null;
  role: Role;
  status: AccountStatus;
  extra_set_enabled: number;
}

/**
 * Resolves a session cookie to its user with a single D1 query.
 * `defer` receives background work (expiry cleanup, last_seen refresh).
 */
export async function loadSession(
  db: D1Database,
  token: string | undefined,
  now: number,
  defer: (p: Promise<unknown>) => void,
): Promise<SessionUser | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.last_seen_at, s.expires_at,
              u.email, u.display_name, u.role, u.status, u.extra_set_enabled
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<SessionJoinRow>();
  if (!row) return null;
  if (row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
    defer(deleteSession(db, tokenHash));
    return null;
  }
  if (now - row.last_seen_at >= SESSION_TOUCH_MS) {
    defer(
      db
        .prepare('UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2')
        .bind(now, tokenHash)
        .run(),
    );
  }
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    extraSet: row.extra_set_enabled === 1,
    tokenHash,
  };
}

export async function deleteSession(db: D1Database, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
}

export async function deleteSessionByToken(
  db: D1Database,
  token: string | undefined,
): Promise<void> {
  if (!token || !TOKEN_RE.test(token)) return;
  await deleteSession(db, await sha256Hex(token));
}

export async function deleteAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId).run();
}
