import { z } from 'zod';

/**
 * Statistics v2 (PLAN §2.6): how much an account is used, as daily counts only — spoken
 * phrases and tapped tiles, never which words, phrases or tiles. Devices count locally and
 * send the totals now and then; the account can opt out (Settings.usageStats), which also
 * deletes what was collected. Administrators see the counts in the admin panel.
 */
export const USAGE_LIMITS = {
  /** A device still sends counts this many days old (older ones are dropped). */
  daysBack: 7,
  /** Daily counters kept on the server. */
  retentionDays: 365,
  /** Days shown in the admin panel's daily chart. */
  adminDays: 30,
  /** One accepted report per account this often; sooner ones get 429 and wait on the device. */
  minIntervalMs: 60_000,
  /** A device sends what it counted this long after the first count (and when hidden). */
  flushMs: 15 * 60_000,
  /** Caps of one day of one account (a stuck or hostile client cannot inflate more). */
  maxUtterances: 10_000,
  maxTiles: 50_000,
} as const;

const DAY_MS = 24 * 3600 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The YYYY-MM-DD key of a UTC timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The YYYY-MM-DD key of a moment in the device's own time zone (what a person calls "today"). */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day key `delta` days after `day` (negative: before). */
export function addDays(day: string, delta: number): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS);
}

export const DayKeySchema = z
  .string()
  .regex(DAY_RE)
  .refine((day) => {
    const ms = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(ms) && utcDay(ms) === day;
  }, 'not a calendar day');

export const UsageDaySchema = z
  .object({
    day: DayKeySchema,
    utterances: z.number().int().min(0).max(USAGE_LIMITS.maxUtterances),
    tiles: z.number().int().min(0).max(USAGE_LIMITS.maxTiles),
  })
  .strict();
export type UsageDay = z.infer<typeof UsageDaySchema>;

/** POST /api/usage: what a device counted since its last report, one entry per day. */
export const UsageBatchSchema = z
  .object({
    days: z
      .array(UsageDaySchema)
      .min(1)
      .max(USAGE_LIMITS.daysBack + 2)
      .refine((days) => new Set(days.map((d) => d.day)).size === days.length, 'duplicate day'),
  })
  .strict();
export type UsageBatch = z.infer<typeof UsageBatchSchema>;

/** GET /api/usage: the account's own counters, oldest day first (also in the data export). */
export interface UsageList {
  days: UsageDay[];
}

/** GET /api/admin/usage: all accounts together, one entry per day with any use. */
export interface AdminUsageDay extends UsageDay {
  /** Accounts that sent counts for that day. */
  accounts: number;
}

export interface AdminUsage {
  /** The first day of the period (USAGE_LIMITS.adminDays long, ending today, UTC). */
  from: string;
  days: AdminUsageDay[];
}
