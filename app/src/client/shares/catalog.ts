import type {
  AcceptShare,
  BoardChanges,
  CatalogEntry,
  CatalogView,
  PatchCatalog,
  PublishCatalog,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { applyChanges, TREE_KEY } from '../boards/data.ts';
import { MEDIA_KEY } from '../media/data.ts';

const CATALOG_KEY = ['catalog'] as const;

/** Catalogue of public boards (PLAN §2.8). */
export function useCatalog() {
  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => api<{ entries: CatalogEntry[] }>('/api/catalog'),
    staleTime: 60_000,
  });
}

export function useCatalogEntry(id: string) {
  return useQuery({
    queryKey: [...CATALOG_KEY, id],
    queryFn: () => api<CatalogView>(`/api/catalog/${id}`),
    staleTime: 60_000,
    retry: false,
  });
}

/** A catalogue entry copied as a new folder on the given board. */
export function useCopyFromCatalog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AcceptShare & { id: string }) =>
      api<BoardChanges>(`/api/catalog/${id}/import`, { method: 'POST', json: input }),
    onSuccess: (changes) => {
      applyChanges(queryClient, changes);
      void queryClient.invalidateQueries({ queryKey: MEDIA_KEY });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'conflict') {
        void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      }
    },
  });
}

export function usePublish() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishCatalog) =>
      api<CatalogEntry>('/api/admin/catalog', { method: 'POST', json: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

export function useEditEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: PatchCatalog & { id: string }) =>
      api<CatalogEntry>(`/api/admin/catalog/${id}`, { method: 'PATCH', json: patch }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

export function useWithdraw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/admin/catalog/${id}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}
