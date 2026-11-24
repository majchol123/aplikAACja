import { describe, expect, it } from 'vitest';
import {
  addDays,
  DayKeySchema,
  localDay,
  UsageBatchSchema,
  USAGE_LIMITS,
  utcDay,
} from './usage.ts';

describe('usage day keys', () => {
  it('steps over month, year and leap-day boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-24', -365)).toBe('2025-11-24');
  });

  it('takes the local calendar day, not the UTC one', () => {
    const lateEvening = new Date(2026, 10, 24, 23, 30);
    expect(localDay(lateEvening)).toBe('2026-11-24');
    expect(utcDay(Date.UTC(2026, 10, 24, 23, 30))).toBe('2026-11-24');
  });

  it('accepts calendar days only', () => {
    expect(DayKeySchema.safeParse('2028-02-29').success).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-01', '24.11.2026', '']) {
      expect(DayKeySchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('carries numbers only, one entry per day', () => {
    const day = { day: '2026-11-24', utterances: 1, tiles: 2 };
    expect(UsageBatchSchema.safeParse({ days: [day] }).success).toBe(true);
    expect(UsageBatchSchema.safeParse({ days: [day, day] }).success).toBe(false);
    expect(UsageBatchSchema.safeParse({ days: [{ ...day, label: 'tak' }] }).success).toBe(false);
    const many = Array.from({ length: USAGE_LIMITS.daysBack + 3 }, (_, i) => ({
      ...day,
      day: addDays('2026-11-01', i),
    }));
    expect(UsageBatchSchema.safeParse({ days: many }).success).toBe(false);
  });
});
