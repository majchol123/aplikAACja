import {
  addDays,
  USAGE_LIMITS,
  UsageBatchSchema,
  utcDay,
  type AdminUsage,
  type AdminUsageDay,
  type UsageDay,
  type UsageList,
} from '@aplikaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';

/**
 * Statistics v2 (PLAN §2.6, shared usage.ts): daily counts of spoken phrases and tapped
 * tiles per account, in D1 next to the account row, so the admin panel reads them without
 * waking any vault. Only numbers ever arrive here.
 */
type Ctx = Context<AppContext>;

/** Rows older than this go (USAGE_LIMITS.retentionDays). */
const cutoff = (now: number) => addDays(utcDay(now), -USAGE_LIMITS.retentionDays);

/**
 * POST /api/usage `{days}` — a device's counts since its last report. An account that opted
 * out gets 204 and nothing is stored. Days outside what a device may still send (a week
 * back, a day ahead for time zones) are dropped silently, so the device forgets them too.
 */
export function recordUsage(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = UsageBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_request' }, 400);
    const user = c.get('user');
    if (!user.usageStats) return c.body(null, 204);
    const at = now();
    const today = utcDay(at);
    const first = addDays(today, -USAGE_LIMITS.daysBack);
    const last = addDays(today, 1);
    const days = input.data.days.filter(
      (d) => d.day >= first && d.day <= last && d.utterances + d.tiles > 0,
    );
    if (days.length === 0) return c.body(null, 204);
    const db = c.env.DB;
    // The throttle and the opt-out in one conditional write: no row changes, no report.
    const claimed = await db
      .prepare(
        `UPDATE users SET usage_sent_at = ?1
          WHERE id = ?2 AND usage_stats = 1 AND (usage_sent_at IS NULL OR usage_sent_at <= ?3)`,
      )
      .bind(at, user.userId, at - USAGE_LIMITS.minIntervalMs)
      .run();
    if (claimed.meta.changes === 0) return c.json({ error: 'rate_limited' }, 429);
    await db.batch([
      ...days.map((d) =>
        db
          .prepare(
            `INSERT INTO usage_daily (user_id, day, utterances, tiles) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (user_id, day) DO UPDATE SET
               utterances = min(utterances + excluded.utterances, ?5),
               tiles = min(tiles + excluded.tiles, ?6)`,
          )
          .bind(
            user.userId,
            d.day,
            d.utterances,
            d.tiles,
            USAGE_LIMITS.maxUtterances,
            USAGE_LIMITS.maxTiles,
          ),
      ),
      // Retention for every account, by the day index: usually reads nothing.
      db.prepare('DELETE FROM usage_daily WHERE day < ?1').bind(cutoff(at)),
    ]);
    return c.body(null, 204);
  };
}

/** GET /api/usage — the account's own counters, oldest day first (for the data export). */
export async function listUsage(c: Ctx): Promise<Response> {
  const { results } = await c.env.DB.prepare(
    'SELECT day, utterances, tiles FROM usage_daily WHERE user_id = ?1 ORDER BY day',
  )
    .bind(c.get('user').userId)
    .all<UsageDay>();
  const list: UsageList = { days: results };
  return c.json(list);
}

/**
 * Settings.usageStats changed (PATCH /api/settings): the D1 copy first, so a failure in
 * between never leaves counting on against the account's wish; off deletes the counts.
 */
export async function setUsageStats(db: D1Database, userId: string, on: boolean): Promise<void> {
  const flag = db
    .prepare('UPDATE users SET usage_stats = ?1 WHERE id = ?2')
    .bind(on ? 1 : 0, userId);
  if (on) await flag.run();
  else
    await db.batch([flag, db.prepare('DELETE FROM usage_daily WHERE user_id = ?1').bind(userId)]);
}

/** GET /api/admin/usage — every account together, per day, for the last USAGE_LIMITS.adminDays. */
export function adminUsage(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const at = now();
    const from = addDays(utcDay(at), -(USAGE_LIMITS.adminDays - 1));
    const { results } = await c.env.DB.prepare(
      `SELECT day, SUM(utterances) AS utterances, SUM(tiles) AS tiles, COUNT(*) AS accounts
         FROM usage_daily WHERE day >= ?1 GROUP BY day ORDER BY day`,
    )
      .bind(from)
      .all<AdminUsageDay>();
    const usage: AdminUsage = { from, days: results };
    return c.json(usage);
  };
}
