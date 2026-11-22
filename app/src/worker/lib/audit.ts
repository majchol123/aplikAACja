import type { AuditAction } from '@relaacja/shared';
import { newId } from './crypto.ts';

/**
 * Admin audit entry (PLAN §2.6): who, when, on whom, what. `details` holds IDs and settings
 * only, never personal data, so entries can outlive the accounts they mention. Returned as
 * a statement to batch with the change it records (both or neither).
 */
export function auditStatement(
  db: D1Database,
  entry: {
    at: number;
    actor: string;
    action: AuditAction;
    target?: string | null;
    details?: Record<string, unknown>;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO admin_audit (id, at, actor_user_id, action, target_user_id, details)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      newId(),
      entry.at,
      entry.actor,
      entry.action,
      entry.target ?? null,
      JSON.stringify(entry.details ?? {}),
    );
}
