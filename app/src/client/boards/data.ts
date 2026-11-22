import {
  SET_BASE,
  type BoardChanges,
  type BoardTree,
  type CreateHome,
  type LibrarySet,
  type Me,
  type Tile,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api, ApiError } from '../api.ts';
import { useManifest, useSymbolIndex } from '../library/data.ts';

export interface CachedTree {
  etag: string;
  tree: BoardTree;
}

export const TREE_KEY = ['boards'] as const;

/** Revalidates with the tree ETag: an unchanged tree costs one row read and no body. */
async function fetchTree(previous: CachedTree | undefined): Promise<CachedTree> {
  const res = await fetch('/api/boards', {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(previous?.etag ? { 'If-None-Match': previous.etag } : {}),
    },
  });
  if (res.status === 304 && previous) return previous;
  if (!res.ok) throw new ApiError(res.status, 'boards_unavailable');
  return { etag: res.headers.get('ETag') ?? '', tree: (await res.json()) as BoardTree };
}

export function useBoardTree() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: TREE_KEY,
    queryFn: () => fetchTree(queryClient.getQueryData<CachedTree>(TREE_KEY)),
    staleTime: 60_000,
    // Picks up edits made on another device (a caregiver's phone) while the tablet stays open.
    refetchInterval: 5 * 60_000,
    select: (cached) => cached.tree,
  });
}

/** Writes answer with the changed boards: patch them in without refetching the tree. */
export function applyChanges(queryClient: QueryClient, changes: BoardChanges): void {
  queryClient.setQueryData<CachedTree>(TREE_KEY, (cached) => {
    if (!cached) return cached;
    const removed = new Set(changes.removed);
    const updated = new Map(changes.boards.map((b) => [b.id, b]));
    const boards = cached.tree.boards
      .filter((b) => !removed.has(b.id))
      .map((b) => updated.get(b.id) ?? b);
    for (const board of changes.boards) {
      if (!cached.tree.boards.some((b) => b.id === board.id)) boards.push(board);
    }
    const home = boards.find((b) => b.parentId === null);
    // The ETag no longer matches this state: drop it so the next fetch gets the full tree.
    return { etag: '', tree: { homeId: home?.id ?? null, boards } };
  });
}

export function useCreateHome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHome) =>
      api<BoardChanges>('/api/boards/home', { method: 'POST', json: input }),
    onSuccess: (changes) => applyChanges(queryClient, changes),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TREE_KEY }),
  });
}

/**
 * Tile symbol → image URL. Library sets resolve through their index (file names carry a
 * content hash that changes when the mirror updates); null = show the label only.
 */
export function useSymbolResolver(me: Me, tiles: readonly Tile[]) {
  const needs = useMemo(() => {
    const sets = new Set<LibrarySet>();
    for (const tile of tiles) {
      if (tile.symbol?.set === 'arasaac') sets.add('arasaac');
      if (tile.symbol?.set === 'extra' && me.extraSet) sets.add('extra');
    }
    return sets;
  }, [tiles, me.extraSet]);
  const arasaacManifest = useManifest('arasaac', needs.has('arasaac'));
  const extraManifest = useManifest('extra', needs.has('extra'));
  const arasaac = useSymbolIndex(arasaacManifest.data, needs.has('arasaac'));
  const extra = useSymbolIndex(extraManifest.data, needs.has('extra'));

  const files = useMemo(() => {
    const map = new Map<string, string>();
    for (const index of [arasaac.data, extra.data]) {
      if (!index) continue;
      for (const item of index.items)
        map.set(`${index.set}:${item.id}`, SET_BASE[index.set] + item.f);
    }
    return map;
  }, [arasaac.data, extra.data]);

  return useCallback(
    (symbol: Tile['symbol']): string | null => {
      if (!symbol || symbol.set === 'own') return null; // own photos: F2 step 4
      return files.get(`${symbol.set}:${symbol.ref}`) ?? null;
    },
    [files],
  );
}
