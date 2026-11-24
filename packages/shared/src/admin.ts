import { z } from 'zod';
import { RoleSchema, STATUSES, type Role } from './api.ts';
import type { BoardTree } from './boards.ts';
import type { MediaList } from './media.ts';
import type { Settings } from './settings.ts';

/**
 * Admin panel (PLAN §2.6). One row of the account list; the counters are the D1 copy of the
 * account's vault counters (refreshed after its writes and tree reads), so the list needs
 * no request to every vault. Statistics v1 are computed from these rows.
 */
export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  /** Effective role: superadmin follows ADMIN_EMAILS, whatever D1 says. */
  role: RoleSchema,
  status: z.enum(STATUSES),
  extraSet: z.boolean(),
  createdAt: z.number(),
  lastLoginAt: z.number().nullable(),
  /** Latest activity of any of its sessions (refreshed at most hourly), null = none left. */
  lastSeenAt: z.number().nullable(),
  blockedAt: z.number().nullable(),
  boards: z.number(),
  tiles: z.number(),
  media: z.number(),
  storageBytes: z.number(),
  /** Statistics v2 (usage.ts): the account lets its usage be counted. */
  usageStats: z.boolean(),
  /** Spoken phrases and tapped tiles in the last 7 and 30 days (UTC days, today included). */
  utterancesWeek: z.number(),
  utterancesMonth: z.number(),
  tilesWeek: z.number(),
  tilesMonth: z.number(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

/** GET /api/admin/users, newest accounts first. */
export interface AdminUserList {
  users: AdminUser[];
  /** More accounts than one list holds (ADMIN_LIST_LIMIT). */
  truncated: boolean;
}

export const ADMIN_LIST_LIMIT = 1000;

export const SetExtraSetSchema = z.object({ enabled: z.boolean() }).strict();
export type SetExtraSet = z.infer<typeof SetExtraSetSchema>;

/** Superadmin comes from the ADMIN_EMAILS secret only, never from the app. */
export const SetRoleSchema = z.object({ role: z.enum(['user', 'admin']) }).strict();
export type SetRole = z.infer<typeof SetRoleSchema>;

/** Hard delete (by an admin, or DELETE /api/me by the account itself) is confirmed by typing
 * the account's e-mail address. */
export const DeleteUserSchema = z.object({ email: z.string().min(1).max(320) }).strict();
export type DeleteUser = z.infer<typeof DeleteUserSchema>;

/** How far back an account can be restored: Cloudflare keeps 30 days of a vault's history. */
export const RESTORE_WINDOW_MS = 30 * 24 * 3600 * 1000;
/** The oldest minutes of the window may be gone by the time a restore runs. */
export const RESTORE_MARGIN_MS = 15 * 60 * 1000;

/** POST /api/admin/users/:id/restore: the moment to go back to, confirmed by the e-mail. */
export const RestoreUserSchema = z
  .object({ at: z.number().int().nonnegative(), email: z.string().min(1).max(320) })
  .strict();
export type RestoreUser = z.infer<typeof RestoreUserSchema>;

export const AUDIT_ACTIONS = [
  'user.block',
  'user.unblock',
  'user.extra_set',
  'user.role',
  'user.delete',
  /** The account deleted itself (Settings → "Usuń konto"); actor = target. */
  'user.delete_self',
  'user.view',
  'user.restore',
  'category_icon.set',
  'category_icon.reset',
  'catalog.publish',
  'catalog.edit',
  'catalog.update',
  'catalog.withdraw',
  'backup.configure',
  'backup.disable',
  'backup.run',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One admin action; `email` is null once that account was deleted (IDs stay). */
export interface AuditEntry {
  id: string;
  at: number;
  action: string;
  actor: { id: string; email: string | null };
  target: { id: string; email: string | null } | null;
  details: Record<string, unknown>;
}

/** GET /api/admin/audit?before=&target=, newest first; `next` is the `before` of the next page. */
export interface AuditPage {
  entries: AuditEntry[];
  next: number | null;
}

export const AUDIT_PAGE_SIZE = 50;

/** GET /api/admin/users/:id/data: read-only view of an account (audited as user.view). */
export interface AdminUserData {
  user: AdminUser;
  tree: BoardTree;
  media: MediaList;
  settings: Settings;
}

/** An own photo of another account, for the admin data view (never cached by the browser). */
export const adminMediaUrl = (userId: string, mediaId: string) =>
  `/api/admin/users/${userId}/media/${mediaId}`;

const RANK: Record<Role, number> = { user: 0, admin: 1, superadmin: 2 };

interface Principal {
  id: string;
  role: Role;
}

/**
 * Who may block, unblock, delete and view whom: only accounts ranked strictly lower, never
 * oneself. Admins manage users, superadmins also admins, nobody manages a superadmin.
 */
export function canManage(actor: Principal, target: Principal): boolean {
  return actor.id !== target.id && RANK[actor.role] > RANK[target.role];
}

/** Granting and revoking the admin role is for superadmins only. */
export function canSetRole(actor: Principal, target: Principal): boolean {
  return actor.role === 'superadmin' && canManage(actor, target);
}

/**
 * Going back to an earlier state of an account is for superadmins, also for their own
 * account (it is their data); never for another superadmin.
 */
export function canRestore(actor: Principal, target: Principal): boolean {
  return actor.role === 'superadmin' && (actor.id === target.id || canManage(actor, target));
}

/**
 * The extra set is passed on only by someone who has it; superadmins always, also to
 * themselves (the first grant has nobody else to come from).
 */
export function canSetExtraSet(
  actor: Principal & { extraSet: boolean },
  target: Principal,
): boolean {
  if (actor.role === 'superadmin') return actor.id === target.id || canManage(actor, target);
  return actor.extraSet && canManage(actor, target);
}
