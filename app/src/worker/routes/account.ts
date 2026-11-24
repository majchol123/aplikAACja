import { DeleteUserSchema, type AuditAction } from '@aplikaacja/shared';
import type { Context } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { AppContext } from '../context.ts';
import type { AppEnv } from '../env.ts';
import { auditStatement } from '../lib/audit.ts';
import { vaultFor } from '../vault/user-vault.ts';

type Ctx = Context<AppContext>;

/**
 * Hard delete (PLAN §4.3), by an admin or by the account itself: `deleting` and no sessions
 * first (nobody signs in or writes meanwhile), then the vault, then the account row
 * (cascading to sessions and usage counters) together with the audit entry, which keeps
 * only IDs. Idempotent: an interrupted run finishes when repeated (the admin panel offers
 * "Dokończ usuwanie" for accounts left `deleting`).
 */
export async function eraseAccount(
  env: AppEnv,
  entry: {
    at: number;
    actor: string;
    action: Extract<AuditAction, 'user.delete' | 'user.delete_self'>;
    target: string;
  },
): Promise<void> {
  const db = env.DB;
  await db.batch([
    db.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1").bind(entry.target),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(entry.target),
  ]);
  await vaultFor(env, entry.target).deleteAll();
  await db.batch([
    db.prepare('DELETE FROM users WHERE id = ?1').bind(entry.target),
    auditStatement(db, entry),
  ]);
}

/**
 * DELETE /api/me `{email}` — the account deletes itself (Settings → "Usuń konto"), confirmed
 * by its own e-mail address like the admin's delete. A superadmin cannot: the role comes
 * from ADMIN_EMAILS and the next sign-in would create the account again (remove the
 * address from the secret first). The answer clears the session cookie and the browser's
 * cache of private files, as a sign-out does.
 */
export function deleteOwnAccount(now: () => number, sessionCookie: string) {
  return async (c: Ctx): Promise<Response> => {
    const input = DeleteUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_request' }, 400);
    const user = c.get('user');
    if (user.role === 'superadmin') return c.json({ error: 'forbidden' }, 403);
    if (input.data.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      return c.json({ error: 'confirmation_mismatch' }, 422);
    }
    await eraseAccount(c.env, {
      at: now(),
      actor: user.userId,
      action: 'user.delete_self',
      target: user.userId,
    });
    deleteCookie(c, sessionCookie, { prefix: 'host' });
    return c.body(null, 204, { 'Clear-Site-Data': '"cache"' });
  };
}
