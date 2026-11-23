import {
  PHRASE_LIMITS,
  PhraseSchema,
  phraseText,
  type Favorite,
  type FavoriteList,
  type PhraseItem,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { api } from '../api.ts';

/**
 * Last utterances (PLAN §2.1): on this device only, never sent to the server (the privacy
 * policy says so), per account, and forgotten at sign-out.
 */
const PREFIX = 'relaacja.history.v1.';
const HistorySchema = z.array(z.object({ at: z.number(), items: PhraseSchema }));
export type HistoryEntry = z.infer<typeof HistorySchema>[number];

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

export function useHistory(userId: string) {
  const key = PREFIX + userId;
  const entries = useSyncExternalStore(subscribe, () => read(key));
  /** Newest first; saying the same again only moves it to the top. */
  const record = useCallback(
    (items: PhraseItem[]) => {
      if (items.length === 0) return;
      const text = phraseText(items);
      const rest = read(key).filter((e) => phraseText(e.items) !== text);
      write(
        key,
        [{ at: Date.now(), items: items.slice(0, PHRASE_LIMITS.maxItems) }, ...rest].slice(
          0,
          PHRASE_LIMITS.historySize,
        ),
      );
    },
    [key],
  );
  const clear = useCallback(() => write(key, []), [key]);
  return { entries, record, clear };
}

/** Sign-out: the next person on this device does not see what was said. */
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
