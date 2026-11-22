import type {
  AcceptShare,
  BoardChanges,
  ReceivedShareView,
  SendShare,
  SentShare,
  ShareLists,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { applyChanges, TREE_KEY } from '../boards/data.ts';

export const SHARES_KEY = ['shares'] as const;

/**
 * Received and sent shares (PLAN §2.8); new ones show up within a few minutes. `fresh`
 * reloads them whenever the caller appears (the settings list of decisions).
 */
export function useShares({ fresh = false } = {}) {
  return useQuery({
    queryKey: SHARES_KEY,
    queryFn: () => api<ShareLists>('/api/shares'),
    staleTime: fresh ? 0 : 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useReceivedShare(id: string) {
  return useQuery({
    queryKey: ['shares', 'received', id],
    queryFn: () => api<ReceivedShareView>(`/api/shares/received/${id}`),
    staleTime: Infinity,
    retry: false,
  });
}

export function useSendShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendShare) =>
      api<{ share: SentShare }>('/api/shares', { method: 'POST', json: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SHARES_KEY }),
  });
}

/** A received share becomes a new folder on the given board. */
export function useAcceptShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AcceptShare & { id: string }) =>
      api<BoardChanges>(`/api/shares/received/${id}/accept`, { method: 'POST', json: input }),
    onSuccess: (changes) => applyChanges(queryClient, changes),
    onError: (err) => {
      // Another device changed that board meanwhile: get the current tree.
      if (err instanceof ApiError && err.code === 'conflict') {
        void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SHARES_KEY }),
  });
}

export function useRejectShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/shares/received/${id}/reject`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SHARES_KEY }),
  });
}

export function useRemoveSent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/shares/sent/${id}`, { method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: SHARES_KEY }),
  });
}

/** Message for a refused send or acceptance. */
export function shareProblem(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Brak połączenia z serwerem. Spróbuj ponownie.';
  switch (err.code) {
    case 'too_large':
      return 'Ta tablica jest za duża do wysłania: najwyżej 100 tablic, 2000 kafelków i 200 zdjęć (10 MB).';
    case 'daily_limit':
      return 'Dziś wysłano już 20 tablic. Następne można wysłać jutro.';
    case 'invalid_request':
      return 'Sprawdź adres e-mail.';
    case 'board_full':
      return 'Na tej tablicy nie ma wolnego pola. Zwolnij jedno albo otwórz inną tablicę.';
    case 'too_deep':
      return 'Tutaj folder byłby za głęboko (najwyżej 10 poziomów). Otwórz tablicę bliżej pulpitu.';
    case 'quota_exceeded':
      return 'Na koncie brakuje miejsca na tyle tablic, kafelków lub zdjęć.';
    case 'conflict':
      return 'Tablica zmieniła się na innym urządzeniu. Spróbuj ponownie.';
    case 'not_found':
      return 'Tej tablicy już nie ma (przyjęta, odrzucona albo wygasła).';
    case 'rate_limited':
      return 'Za dużo zmian naraz. Odczekaj chwilę.';
    default:
      return 'Nie udało się. Spróbuj ponownie.';
  }
}
