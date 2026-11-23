import {
  HistoryItemSchema,
  PHRASE_LIMITS,
  phraseText,
  type Favorite,
  type FavoriteList,
  type HistoryEntry,
  type HistoryList,
  type PhraseItem,
} from '@aplikaacja/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { api } from '../api.ts';
import { useAccountSettings } from '../settings/account.ts';

export type { HistoryEntry };

/**
 * Last utterances (PLAN §2.1), saved on the account unless switched off in the settings,
 * so every device shows the same. A device collects them and sends them in batches —
 * after HISTORY_BATCH utterances, FLUSH_MS after the first unsent one, when the page is
 * hidden, and before the history is shown — to spare the request budget (PLAN §3.2).
 * Unsent ones wait in localStorage, per account; sign-out forgets them.
 */
const PREFIX = 'aplikaacja.history.pending.v1.';
export const HISTORY_BATCH = 10;
const FLUSH_MS = 5 * 60_000;
const HISTORY_KEY = ['history'] as const;
const HistorySchema = z.array(HistoryItemSchema);

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: HistoryEntry[] }>();
const EMPTY: HistoryEntry[] = [];

function read(key: string): HistoryEntry[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage disabled (private mode): no history.
  }
  const known = cache.get(key);
  if (known && known.raw === raw) return known.value;
  let value = EMPTY;
  try {
    const parsed = HistorySchema.safeParse(raw ? JSON.parse(raw) : []);
    if (parsed.success) value = parsed.data;
  } catch {
    // Damaged entry: start again.
  }
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, value: HistoryEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or disabled storage: the history is a convenience, not data.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key?.startsWith(PREFIX) && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Newest first, the same words once (the first, newest, copy wins). */
function merge(...lists: HistoryEntry[][]): HistoryEntry[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .sort((a, b) => b.at - a.at)
    .filter((e) => {
      const text = phraseText(e.items);
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .slice(0, PHRASE_LIMITS.historySize);
}

let timer: number | undefined;
let inFlight: Promise<HistoryList | null> | null = null;

/**
 * Sends what waits, oldest first, HISTORY_BATCH at a time; resolves with the account's
 * history after the last batch (null when nothing waited). What fails stays for later.
 */
function sendPending(
  userId: string,
  queryClient: QueryClient,
  keepalive = false,
): Promise<HistoryList | null> {
  window.clearTimeout(timer);
  timer = undefined;
  inFlight ??= (async () => {
    const key = PREFIX + userId;
    let last: HistoryList | null = null;
    for (let left = read(key); left.length > 0; left = read(key)) {
      const batch = left.slice(-HISTORY_BATCH);
      last = await api<HistoryList>('/api/history', {
        method: 'POST',
        json: { entries: batch },
        keepalive,
      });
      const sent = new Set(batch.map((e) => `${e.at}|${phraseText(e.items)}`));
      write(
        key,
        read(key).filter((e) => !sent.has(`${e.at}|${phraseText(e.items)}`)),
      );
      queryClient.setQueryData(HISTORY_KEY, last);
    }
    return last;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * The history as this device knows it: the account's (fetched when `open`) and what waits
 * to be sent. `record` keeps an utterance, `clear` empties the history on every device.
 */
export function useHistory(userId: string, open: boolean) {
  const queryClient = useQueryClient();
  const settings = useAccountSettings();
  const keep = settings.data?.keepHistory ?? true;
  const key = PREFIX + userId;
  const pending = useSyncExternalStore(subscribe, () => read(key));
  const remote = useQuery({
    queryKey: HISTORY_KEY,
    // Sending first answers with the whole history: no second request.
    queryFn: async () =>
      (await sendPending(userId, queryClient).catch(() => null)) ??
      api<HistoryList>('/api/history'),
    enabled: open && keep,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!keep) {
      if (read(key).length > 0) write(key, []);
      return;
    }
    if (read(key).length > 0) {
      timer ??= window.setTimeout(
        () => void sendPending(userId, queryClient).catch(() => {}),
        FLUSH_MS,
      );
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden' && read(key).length > 0) {
        void sendPending(userId, queryClient, true).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [userId, key, keep, queryClient]);

  const record = useCallback(
    (items: PhraseItem[]) => {
      if (items.length === 0 || !keep) return;
      const entry = { at: Date.now(), items: items.slice(0, PHRASE_LIMITS.maxItems) };
      const waiting = merge([entry], read(key));
      write(key, waiting);
      if (waiting.length >= HISTORY_BATCH) {
        void sendPending(userId, queryClient).catch(() => {});
      } else {
        timer ??= window.setTimeout(
          () => void sendPending(userId, queryClient).catch(() => {}),
          FLUSH_MS,
        );
      }
    },
    [key, keep, userId, queryClient],
  );
  const clear = useMutation({
    mutationFn: () => api('/api/history', { method: 'DELETE' }),
    onSuccess: () => {
      write(key, []);
      queryClient.setQueryData<HistoryList>(HISTORY_KEY, { entries: [] });
    },
  });
  const entries = useMemo(
    () => (keep ? merge(pending, remote.data?.entries ?? []) : []),
    [keep, pending, remote.data],
  );
  return {
    entries,
    keep,
    loading: open && keep && remote.isPending,
    record,
    clear,
  };
}

/** Before signing out: what waits goes to the account (if it can). */
export async function sendHistoryNow(userId: string, queryClient: QueryClient): Promise<void> {
  await sendPending(userId, queryClient).catch(() => null);
}

/** Sign-out: nothing of the history stays on the device. */
export function forgetHistory(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // Storage disabled: nothing was kept.
  }
  cache.clear();
}

// --- favourites (on the account) --------------------------------------------------------

const FAVORITES_KEY = ['favorites'] as const;

export function useFavorites() {
  return useQuery({
    queryKey: FAVORITES_KEY,
    queryFn: () => api<FavoriteList>('/api/favorites'),
    staleTime: 5 * 60_000,
  });
}

export function useAddFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: PhraseItem[]) =>
      api<Favorite>('/api/favorites', { method: 'POST', json: { items } }),
    onSuccess: (favorite) =>
      queryClient.setQueryData<FavoriteList>(FAVORITES_KEY, (list) =>
        list && !list.favorites.some((f) => f.id === favorite.id)
          ? { favorites: [...list.favorites, favorite] }
          : list,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }),
  });
}

export function useRemoveFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/favorites/${id}`, { method: 'DELETE' }),
    onSuccess: (_r, id) =>
      queryClient.setQueryData<FavoriteList>(FAVORITES_KEY, (list) =>
        list ? { favorites: list.favorites.filter((f) => f.id !== id) } : list,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: FAVORITES_KEY }),
  });
}
