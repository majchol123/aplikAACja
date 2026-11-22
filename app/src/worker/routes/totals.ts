import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { defer } from '../lib/defer.ts';
import type { VaultTotals } from '../vault/user-vault.ts';

/**
 * Copies an account's vault counters to D1 for the admin panel (PLAN §2.6), after the
 * response. Rewrites the row only when a figure changed: a tree read or a label edit costs
 * one row read and no write.
 */
export function recordTotals(c: Context<AppContext>, userId: string, totals: VaultTotals): void {
  defer(c)(
    c.env.DB.prepare(
      `UPDATE users SET boards_count = ?1, tiles_count = ?2, media_count = ?3, storage_bytes = ?4
        WHERE id = ?5
          AND (boards_count, tiles_count, media_count, storage_bytes) IS NOT (?1, ?2, ?3, ?4)`,
    )
      .bind(totals.boards, totals.tiles, totals.media, totals.mediaBytes, userId)
      .run(),
  );
}
