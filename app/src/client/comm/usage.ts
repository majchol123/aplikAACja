import { addDays, localDay, USAGE_LIMITS, type UsageDay } from '@aplikaacja/shared';
import { useCallback, useEffect } from 'react';
import { api, ApiError } from '../api.ts';
import { useAccountSettings } from '../settings/account.ts';

/**
 * Statistics v2 (shared usage.ts): this device counts spoken phrases and tapped tiles per
 * day — numbers only — and sends the totals USAGE_LIMITS.flushMs after the first count,
 * when the page is hidden and before sign-out, so counting costs no request per tap
 * (PLAN §3.2). Unsent counts wait in localStorage, per account; sign-out, deleting the
 * account and switching the counters off (Settings.usageStats) forget them.
 */
const PREFIX = 'aplikaacja.usage.pending.v1.';

export type UsageKind = 'utterances' | 'tiles';
type Pending = Record<string, { utterances: number; tiles: number }>;

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);

function read(userId: string): Pending {
  const pending: Pending = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFIX + userId) ?? '{}');
    if (raw && typeof raw === 'object') {
      for (const [day, c] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !c || typeof c !== 'object') continue;
        pending[day] = { utterances: count(c.utterances), tiles: count(c.tiles) };
      }
    }
  } catch {
    // Damaged entry or storage disabled: nothing waits.
  }
  return pending;
}

function write(userId: string, pending: Pending): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(PREFIX + userId);
    else localStorage.setItem(PREFIX + userId, JSON.stringify(pending));
  } catch {
    // Full or disabled storage: a count is lost, nothing else.
  }
}

/** The days a report may carry (the server drops older ones), capped as the server caps. */
function report(pending: Pending): UsageDay[] {
  const oldest = addDays(localDay(new Date()), -USAGE_LIMITS.daysBack);
  return Object.entries(pending)
    .filter(([day, c]) => day >= oldest && c.utterances + c.tiles > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-(USAGE_LIMITS.daysBack + 2))
    .map(([day, c]) => ({
      day,
      utterances: Math.min(c.utterances, USAGE_LIMITS.maxUtterances),
      tiles: Math.min(c.tiles, USAGE_LIMITS.maxTiles),
    }));
}

let timer: number | undefined;
let inFlight: Promise<void> | null = null;

function schedule(userId: string): void {
  timer ??= window.setTimeout(() => {
    timer = undefined;
    void send(userId).catch(() => schedule(userId));
  }, USAGE_LIMITS.flushMs);
}

/** Sends what waits; what was counted meanwhile stays. A failed report stays for later. */
function send(userId: string, keepalive = false): Promise<void> {
  window.clearTimeout(timer);
  timer = undefined;
  inFlight ??= (async () => {
    const days = report(read(userId));
    if (days.length > 0) {
      try {
        await api('/api/usage', { method: 'POST', json: { days }, keepalive });
      } catch (err) {
        // Refused for good (not "too soon" or offline): drop it rather than retry forever.
        if (!(err instanceof ApiError) || err.status === 429 || err.status >= 500) throw err;
      }
    }
    const sent = new Map(days.map((d) => [d.day, d]));
    const oldest = addDays(localDay(new Date()), -USAGE_LIMITS.daysBack);
    const left = Object.entries(read(userId)).flatMap(([day, c]) => {
      const s = sent.get(day);
      const utterances = Math.max(0, c.utterances - (s?.utterances ?? 0));
      const tiles = Math.max(0, c.tiles - (s?.tiles ?? 0));
      return day >= oldest && utterances + tiles > 0 ? [[day, { utterances, tiles }] as const] : [];
    });
    write(userId, Object.fromEntries(left));
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const waiting = (userId: string) => Object.keys(read(userId)).length > 0;

/**
 * Counting for communication mode: `count('tiles')` per word added to the sentence (a tile
 * or a symbol from "Wszystkie symbole"), `count('utterances')` per phrase spoken with ▶ or
 * replayed from the history or favourites. Nothing is counted while the
 * account has the counters off (and what waited is forgotten).
 */
export function useUsageCounter(userId: string): (kind: UsageKind) => void {
  const settings = useAccountSettings();
  const on = settings.data?.usageStats ?? true;

  useEffect(() => {
    if (!on) {
      write(userId, {});
      return;
    }
    if (waiting(userId)) schedule(userId);
    const onHide = () => {
      if (document.visibilityState === 'hidden' && waiting(userId)) {
        void send(userId, true).catch(() => schedule(userId));
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [userId, on]);

  return useCallback(
    (kind: UsageKind) => {
      if (!on) return;
      const pending = read(userId);
      const day = (pending[localDay(new Date())] ??= { utterances: 0, tiles: 0 });
      day[kind] += 1;
      write(userId, pending);
      schedule(userId);
    },
    [userId, on],
  );
}

/** Before signing out or exporting the account's data: what waits goes to the account. */
export async function sendUsageNow(userId: string): Promise<void> {
  await send(userId).catch(() => undefined);
}

/** Sign-out and account deletion: no counts stay on the device. */
export function forgetUsage(): void {
  window.clearTimeout(timer);
  timer = undefined;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // Storage disabled: nothing was kept.
  }
}
