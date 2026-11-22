import { z } from 'zod';
import { SymbolRefSchema, TileLabelSchema, type SymbolRef } from './boards.ts';
import { normalizeText } from './normalize.ts';

/**
 * Preferred variant of a word (PLAN §2.2): when several symbols match a word, the one the
 * user picked last comes first in later searches and in the phrase generator. Keyed by the
 * normalized keyword of the chosen symbol ("Jabłko" and "jablko" are the same word).
 */
export const PREFERRED_LIMIT = 5000;

export function preferredKey(word: string): string {
  return normalizeText(word);
}

export const PutPreferredSchema = z
  .object({
    word: TileLabelSchema.refine((w) => preferredKey(w) !== '', 'no letters or digits'),
    symbol: SymbolRefSchema,
  })
  .strict();
export type PutPreferred = z.infer<typeof PutPreferredSchema>;

export interface PreferredSymbol {
  /** Normalized word (preferredKey). */
  word: string;
  symbol: SymbolRef;
}

/** GET /api/symbols/preferred */
export interface PreferredSymbols {
  items: PreferredSymbol[];
}
