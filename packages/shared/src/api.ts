import { z } from 'zod';

export const ROLES = ['user', 'admin', 'superadmin'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const STATUSES = ['active', 'blocked', 'deleting'] as const;
export type AccountStatus = (typeof STATUSES)[number];

/** Header every state-changing request must carry (CSRF defence, see PLAN §4.1). */
export const CSRF_HEADER = 'X-Aplikaacja';

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: RoleSchema,
  extraSet: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

export type ApiErrorCode =
  | 'unauthenticated'
  | 'blocked'
  | 'forbidden'
  | 'not_found'
  | 'csrf'
  | 'cookie_conflict'
  | 'invalid_request'
  | 'extra_set_not_enabled'
  | 'extra_set_unavailable'
  | 'rate_limited'
  | 'payload_too_large'
  // Boards and tiles (PLAN §3.5).
  | 'conflict'
  | 'already_initialized'
  | 'cell_occupied'
  | 'out_of_bounds'
  | 'invalid_move'
  | 'too_deep'
  | 'quota_exceeded'
  | 'unknown_symbol'
  // Admin panel (PLAN §2.6): the typed e-mail does not match the account to delete.
  | 'confirmation_mismatch'
  | 'internal';
