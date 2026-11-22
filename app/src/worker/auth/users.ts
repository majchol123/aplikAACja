import type { AccountStatus, Role } from '@relaacja/shared';
import { newId } from '../lib/crypto.ts';
import type { GoogleIdentity } from './google.ts';

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  display_name: string | null;
  role: Role;
  status: AccountStatus;
  extra_set_enabled: number;
  storage_bytes: number;
  created_at: number;
  last_login_at: number | null;
  blocked_at: number | null;
}

const adminEmailCache = new Map<string, Set<string>>();

export function parseAdminEmails(raw: string | undefined): Set<string> {
  const key = raw ?? '';
  let parsed = adminEmailCache.get(key);
  if (!parsed) {
    parsed = new Set(
      key
        .split(/[\s,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@')),
    );
    adminEmailCache.set(key, parsed);
  }
  return parsed;
}

/**
 * The ADMIN_EMAILS secret is the only source of the superadmin role: listed → superadmin,
 * a stored superadmin that is no longer listed → user. Other roles are kept as stored.
 * Same rule as the SQL in upsertGoogleUser, applied on every request so that removing an
 * address from the secret takes effect immediately, not at the next login.
 */
export function effectiveRole(stored: Role, email: string, admins: Set<string>): Role {
  if (admins.has(email.toLowerCase())) return 'superadmin';
  return stored === 'superadmin' ? 'user' : stored;
}

/**
 * Creates or refreshes the account for a verified Google identity.
 * Superadmin is derived from the ADMIN_EMAILS secret on every login: listed → superadmin,
 * delisted superadmin → user. Roles granted in the app (admin) are otherwise preserved.
 */
export async function upsertGoogleUser(
  db: D1Database,
  identity: GoogleIdentity,
  isSuperadmin: boolean,
  now: number,
): Promise<UserRow> {
  const row = await db
    .prepare(
      `INSERT INTO users (id, google_sub, email, display_name, role, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, CASE WHEN ?5 THEN 'superadmin' ELSE 'user' END, ?6, ?6)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_login_at = excluded.last_login_at,
         role = CASE
           WHEN ?5 THEN 'superadmin'
           WHEN users.role = 'superadmin' THEN 'user'
           ELSE users.role
         END
       RETURNING *`,
    )
    .bind(newId(), identity.sub, identity.email, identity.name, isSuperadmin ? 1 : 0, now)
    .first<UserRow>();
  if (!row) throw new Error('user upsert returned no row');
  return row;
}
