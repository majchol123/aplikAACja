import {
  preferredKey,
  type PreferredSymbol,
  type PreferredSymbols,
  type PutPreferred,
  type SymbolRef,
} from '@aplikaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';

export const PREFERRED_KEY = ['preferred-symbols'] as const;
const KEY = PREFERRED_KEY;

const toMap = (data: PreferredSymbols) =>
  new Map<string, SymbolRef>(data.items.map((i) => [i.word, i.symbol]));

/** Preferred variant per normalized word (PLAN §2.2). */
export function usePreferredSymbols(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api<PreferredSymbols>('/api/symbols/preferred'),
    staleTime: 5 * 60_000,
    select: toMap,
    enabled,
  });
}

export function useSetPreferred() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PutPreferred) =>
      api<PreferredSymbol>('/api/symbols/preferred', { method: 'PUT', json: input }),
    onSuccess: (saved) =>
      queryClient.setQueryData<PreferredSymbols>(KEY, (data) => ({
        items: [...(data?.items ?? []).filter((i) => i.word !== saved.word), saved],
      })),
  });
}

export function isPreferred(
  preferred: Map<string, SymbolRef> | undefined,
  word: string,
  symbol: SymbolRef,
): boolean {
  const chosen = preferred?.get(preferredKey(word));
  return chosen !== undefined && chosen.set === symbol.set && chosen.ref === symbol.ref;
}
