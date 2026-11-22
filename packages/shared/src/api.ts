import { z } from 'zod';

export const ROLES = ['user', 'admin', 'superadmin'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const STATUSES = ['active', 'blocked', 'deleting'] as const;
export type AccountStatus = (typeof STATUSES)[number];

/** Header every state-changing request must carry (CSRF defence, see PLAN §4.1). */
export const CSRF_HEADER = 'X-Relaacja';

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: RoleSchema,
  extraSet: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: RoleSchema,
  status: z.enum(STATUSES),
  extraSet: z.boolean(),
  storageBytes: z.number(),
  createdAt: z.number(),
  lastLoginAt: z.number().nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

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
  | 'internal';
