import {
  ADMIN_LIST_LIMIT,
  AUDIT_PAGE_SIZE,
  canManage,
  canRestore,
  canSetExtraSet,
  canSetRole,
  DeleteUserSchema,
  ObjectIdSchema,
  RESTORE_MARGIN_MS,
  RESTORE_WINDOW_MS,
  RestoreUserSchema,
  SetExtraSetSchema,
  SetRoleSchema,
  type AdminUser,
  type AdminUserData,
  type AdminUserList,
  type AuditEntry,
  type AuditPage,
  type BoardTree,
} from '@aplikaacja/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { effectiveRole, parseAdminEmails } from '../auth/users.ts';
import type { AppContext } from '../context.ts';
import { auditStatement } from '../lib/audit.ts';
import { vaultFor } from '../vault/user-vault.ts';
import { eraseAccount } from './account.ts';
import { recordTotals } from './totals.ts';

/**
 * Admin panel (PLAN §2.6). These are the only routes where a request parameter selects
 * another account (and its vault): every one of them sits behind the admin guard, checks
 * the rank rules of the shared `canManage` family against the target's effective role and
 * records what it changed or showed in admin_audit.
 */
type Ctx = Context<AppContext>;

interface AdminUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: AdminUser['role'];
  status: AdminUser['status'];
  extra_set_enabled: number;
  created_at: number;
  last_login_at: number | null;
  last_seen_at: number | null;
  blocked_at: number | null;
  boards_count: number;
  tiles_count: number;
  media_count: number;
  storage_bytes: number;
  usage_stats: number;
  utterances_week: number;
  utterances_month: number;
  tiles_week: number;
  tiles_month: number;
}

const USER_COLUMNS = `u.id, u.email, u.display_name, u.role, u.status, u.extra_set_enabled,
  u.created_at, u.last_login_at, u.blocked_at, u.boards_count, u.tiles_count, u.media_count,
  u.storage_bytes, (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
  u.usage_stats, COALESCE(g.utterances_week, 0) AS utterances_week,
  COALESCE(g.utterances_month, 0) AS utterances_month, COALESCE(g.tiles_week, 0) AS tiles_week,
  COALESCE(g.tiles_month, 0) AS tiles_month`;

/**
 * Accounts with their usage of the last 7 and 30 days (statistics v2): one pass over that
 * month's rows by the day index, not one per account. Days are UTC dates, the stored ones
 * the devices' local dates; at this scale the difference of a few hours does not matter.
 */
const USERS_FROM = `users u LEFT JOIN (
    SELECT user_id,
           SUM(CASE WHEN day >= date('now', '-6 days') THEN utterances ELSE 0 END) AS utterances_week,
           SUM(utterances) AS utterances_month,
           SUM(CASE WHEN day >= date('now', '-6 days') THEN tiles ELSE 0 END) AS tiles_week,
           SUM(tiles) AS tiles_month
      FROM usage_daily WHERE day >= date('now', '-29 days') GROUP BY user_id
  ) g ON g.user_id = u.id`;

function toAdminUser(row: AdminUserRow, admins: Set<string>): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: effectiveRole(row.role, row.email, admins),
    status: row.status,
    extraSet: row.extra_set_enabled === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastSeenAt: row.last_seen_at,
    blockedAt: row.blocked_at,
    boards: row.boards_count,
    tiles: row.tiles_count,
    media: row.media_count,
    storageBytes: row.storage_bytes,
    usageStats: row.usage_stats === 1,
    utterancesWeek: row.utterances_week,
    utterancesMonth: row.utterances_month,
    tilesWeek: row.tiles_week,
    tilesMonth: row.tiles_month,
  };
}

const invalid = (c: Ctx) => c.json({ error: 'invalid_request' }, 400);
const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);
const forbidden = (c: Ctx) => c.json({ error: 'forbidden' }, 403);

/** The acting admin, in the shape of the shared rank rules. */
function actor(c: Ctx) {
  const user = c.get('user');
  return { id: user.userId, role: user.role, extraSet: user.extraSet };
}

async function readBody<T>(c: Ctx, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

async function loadUser(c: Ctx, id: string): Promise<AdminUser | null> {
  const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM ${USERS_FROM} WHERE u.id = ?1`)
    .bind(id)
    .first<AdminUserRow>();
  return row ? toAdminUser(row, parseAdminEmails(c.env.ADMIN_EMAILS)) : null;
}

/** The account named by `:id`; malformed IDs are as missing as unknown ones. */
async function target(c: Ctx): Promise<AdminUser | null> {
  const id = c.req.param('id');
  return ObjectIdSchema.safeParse(id).success && id ? loadUser(c, id) : null;
}

/** The account as it is after a change (it exists: only deletion removes it). */
async function answerUser(c: Ctx, id: string): Promise<Response> {
  const user = await loadUser(c, id);
  return user ? c.json(user) : notFound(c);
}

/** GET /api/admin/users */
export async function listUsers(c: Ctx): Promise<Response> {
  const { results } = await c.env.DB.prepare(
    `SELECT ${USER_COLUMNS} FROM ${USERS_FROM} ORDER BY u.created_at DESC, u.id LIMIT ?1`,
  )
    .bind(ADMIN_LIST_LIMIT + 1)
    .all<AdminUserRow>();
  const admins = parseAdminEmails(c.env.ADMIN_EMAILS);
  const list: AdminUserList = {
    users: results.slice(0, ADMIN_LIST_LIMIT).map((row) => toAdminUser(row, admins)),
    truncated: results.length > ADMIN_LIST_LIMIT,
  };
  return c.json(list);
}

/**
 * POST /api/admin/users/:id/block — the account keeps its data, all its sessions end now
 * and it cannot sign in again until unblocked. Blocking a blocked account changes nothing.
 */
export function blockUser(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canManage(actor(c), user)) return forbidden(c);
    if (user.status === 'deleting') return c.json({ error: 'conflict' }, 409);
    if (user.status === 'active') {
      const db = c.env.DB;
      const at = now();
      await db.batch([
        db
          .prepare(
            "UPDATE users SET status = 'blocked', blocked_at = ?1 WHERE id = ?2 AND status = 'active'",
          )
          .bind(at, user.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id),
        auditStatement(db, { at, actor: actor(c).id, action: 'user.block', target: user.id }),
      ]);
    }
    return answerUser(c, user.id);
  };
}

/** POST /api/admin/users/:id/unblock */
export function unblockUser(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canManage(actor(c), user)) return forbidden(c);
    if (user.status === 'deleting') return c.json({ error: 'conflict' }, 409);
    if (user.status === 'blocked') {
      const db = c.env.DB;
      const at = now();
      await db.batch([
        db
          .prepare(
            "UPDATE users SET status = 'active', blocked_at = NULL WHERE id = ?1 AND status = 'blocked'",
          )
          .bind(user.id),
        auditStatement(db, { at, actor: actor(c).id, action: 'user.unblock', target: user.id }),
      ]);
    }
    return answerUser(c, user.id);
  };
}

/** POST /api/admin/users/:id/extra-set `{enabled}` — the optional extra symbol set (PLAN D5). */
export function setExtraSet(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = await readBody(c, SetExtraSetSchema);
    if (!input) return invalid(c);
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canSetExtraSet(actor(c), user)) return forbidden(c);
    if (user.status === 'deleting') return c.json({ error: 'conflict' }, 409);
    if (user.extraSet !== input.enabled) {
      const db = c.env.DB;
      await db.batch([
        db
          .prepare('UPDATE users SET extra_set_enabled = ?1 WHERE id = ?2')
          .bind(input.enabled ? 1 : 0, user.id),
        auditStatement(db, {
          at: now(),
          actor: actor(c).id,
          action: 'user.extra_set',
          target: user.id,
          details: { enabled: input.enabled },
        }),
      ]);
    }
    return answerUser(c, user.id);
  };
}

/** POST /api/admin/users/:id/role `{role: 'admin' | 'user'}` — superadmins only. */
export function setRole(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = await readBody(c, SetRoleSchema);
    if (!input) return invalid(c);
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canSetRole(actor(c), user)) return forbidden(c);
    if (user.status === 'deleting') return c.json({ error: 'conflict' }, 409);
    if (user.role !== input.role) {
      const db = c.env.DB;
      await db.batch([
        // Never touches a superadmin (canSetRole), so the stored role is the effective one.
        db.prepare('UPDATE users SET role = ?1 WHERE id = ?2').bind(input.role, user.id),
        auditStatement(db, {
          at: now(),
          actor: actor(c).id,
          action: 'user.role',
          target: user.id,
          details: { role: input.role },
        }),
      ]);
    }
    return answerUser(c, user.id);
  };
}

/**
 * DELETE /api/admin/users/:id `{email}` — hard delete (PLAN §4.3): status `deleting` (no
 * sign-in, sessions gone), the whole vault, then the D1 row with the audit entry. Each step
 * can be repeated, so an interrupted deletion finishes when it is retried.
 */
export function deleteUser(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = await readBody(c, DeleteUserSchema);
    if (!input) return invalid(c);
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canManage(actor(c), user)) return forbidden(c);
    if (input.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      return c.json({ error: 'confirmation_mismatch' }, 422);
    }
    await eraseAccount(c.env, {
      at: now(),
      actor: actor(c).id,
      action: 'user.delete',
      target: user.id,
    });
    return c.body(null, 204);
  };
}

/** Step 3 of a restore runs on the restarted vault, which may take a moment to come up. */
async function finishRestore(c: Ctx, id: string, maxRev: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await vaultFor(c.env, id).finishRestore(maxRev);
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}

/**
 * POST /api/admin/users/:id/restore `{at, email}` — point-in-time recovery of the whole vault
 * (PLAN §6): boards, photos, settings, favourites and history become what they were at `at`,
 * up to 30 days back; the account itself (D1: role, sessions) stays. Superadmins only, also
 * for their own account. Undone by restoring to the moment before (its audit entry).
 */
export function restoreUser(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = await readBody(c, RestoreUserSchema);
    if (!input) return invalid(c);
    const user = await target(c);
    if (!user) return notFound(c);
    if (!canRestore(actor(c), user)) return forbidden(c);
    if (user.status === 'deleting') return c.json({ error: 'conflict' }, 409);
    if (input.email.trim().toLowerCase() !== user.email.toLowerCase()) {
      return c.json({ error: 'confirmation_mismatch' }, 422);
    }
    const at = now();
    // Before the account existed there is only an empty vault to go back to.
    const oldest = Math.max(at - RESTORE_WINDOW_MS + RESTORE_MARGIN_MS, user.createdAt);
    if (input.at >= at || input.at < oldest) return c.json({ error: 'out_of_range' }, 422);
    const prepared = await vaultFor(c.env, user.id).prepareRestore(input.at);
    // Nothing changed (in local development Cloudflare keeps no history).
    if (!prepared) return c.json({ error: 'restore_unavailable' }, 503);
    // From here the restore happens at the vault's next start whatever else fails, so it is
    // recorded before that start.
    await auditStatement(c.env.DB, {
      at,
      actor: actor(c).id,
      action: 'user.restore',
      target: user.id,
      details: { to: input.at },
    }).run();
    try {
      await vaultFor(c.env, user.id).restart();
    } catch {
      // Expected: the call ends with the object it restarted.
    }
    const totals = await finishRestore(c, user.id, prepared.maxRev).catch((err: unknown) => {
      console.error('restore: not finished', err);
      return null;
    });
    if (!totals) return c.json({ error: 'restore_incomplete' }, 500);
    recordTotals(c, user.id, totals);
    return answerUser(c, user.id);
  };
}

/** The account named by `:id` if the caller may look into it. */
async function viewable(c: Ctx): Promise<AdminUser | Response> {
  const user = await target(c);
  // A vault being deleted is as gone as a missing one.
  if (!user || user.status === 'deleting') return notFound(c);
  if (!canManage(actor(c), user)) return forbidden(c);
  return user;
}

/** GET /api/admin/users/:id/data — read-only view of boards, photos and settings, audited. */
export function userData(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const user = await viewable(c);
    if (user instanceof Response) return user;
    const snapshot = await vaultFor(c.env, user.id).snapshot();
    // Recorded before anything is shown.
    await auditStatement(c.env.DB, {
      at: now(),
      actor: actor(c).id,
      action: 'user.view',
      target: user.id,
    }).run();
    recordTotals(c, user.id, snapshot.totals);
    const data: AdminUserData = {
      user: {
        ...user,
        boards: snapshot.totals.boards,
        tiles: snapshot.totals.tiles,
        media: snapshot.totals.media,
        storageBytes: snapshot.totals.mediaBytes,
      },
      tree: JSON.parse(snapshot.tree) as BoardTree,
      media: snapshot.media,
      settings: snapshot.settings,
    };
    return c.json(data);
  };
}

/**
 * GET /api/admin/users/:id/media/:mediaId — a photo shown by the data view. Photo IDs are
 * random and only learnt from that (audited) view; the admin's browser does not keep them.
 */
export async function userMedia(c: Ctx): Promise<Response> {
  const user = await viewable(c);
  if (user instanceof Response) return user;
  const mediaId = c.req.param('mediaId');
  const media =
    mediaId && ObjectIdSchema.safeParse(mediaId).success
      ? await vaultFor(c.env, user.id).getMedia(mediaId)
      : null;
  if (!media) return notFound(c);
  return c.body(media.data, 200, {
    'Content-Type': media.mime,
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
  });
}

interface AuditRow {
  seq: number;
  id: string;
  at: number;
  action: string;
  actor_user_id: string;
  actor_email: string | null;
  target_user_id: string | null;
  target_email: string | null;
  details: string | null;
}

const SEQ_RE = /^[1-9][0-9]{0,15}$/;

function parseDetails(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** GET /api/admin/audit?before=&target= — newest first, AUDIT_PAGE_SIZE per page. */
export async function listAudit(c: Ctx): Promise<Response> {
  const before = c.req.query('before');
  const targetId = c.req.query('target');
  if (before !== undefined && !SEQ_RE.test(before)) return invalid(c);
  if (targetId !== undefined && !ObjectIdSchema.safeParse(targetId).success) return invalid(c);
  const where: string[] = [];
  const params: (string | number)[] = [AUDIT_PAGE_SIZE + 1];
  if (before !== undefined) {
    params.push(Number(before));
    where.push(`a.rowid < ?${params.length}`);
  }
  if (targetId !== undefined) {
    params.push(targetId);
    where.push(`a.target_user_id = ?${params.length}`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT a.rowid AS seq, a.id, a.at, a.action, a.actor_user_id, a.target_user_id, a.details,
            ua.email AS actor_email, ut.email AS target_email
       FROM admin_audit a
       LEFT JOIN users ua ON ua.id = a.actor_user_id
       LEFT JOIN users ut ON ut.id = a.target_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.rowid DESC
      LIMIT ?1`,
  )
    .bind(...params)
    .all<AuditRow>();
  const rows = results.slice(0, AUDIT_PAGE_SIZE);
  const entries: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    actor: { id: r.actor_user_id, email: r.actor_email },
    target: r.target_user_id ? { id: r.target_user_id, email: r.target_email } : null,
    details: parseDetails(r.details),
  }));
  const page: AuditPage = {
    entries,
    next: results.length > AUDIT_PAGE_SIZE ? (rows.at(-1)?.seq ?? null) : null,
  };
  return c.json(page);
}
