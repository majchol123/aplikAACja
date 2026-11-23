import { z } from 'zod';
import { SymbolRefSchema, TileLabelSchema } from './boards.ts';

/**
 * Phrases of communication mode (PLAN §2.1): the last utterances stay on the device only
 * (not on the server), favourites are saved on the account so every device has them.
 */
export const PHRASE_LIMITS = {
  /** Words of one phrase (the sentence bar holds at most as many). */
  maxItems: 30,
  maxFavorites: 200,
  historySize: 50,
} as const;

export const PhraseItemSchema = z
  .object({ label: TileLabelSchema, symbol: SymbolRefSchema.nullable() })
  .strict();
export type PhraseItem = z.infer<typeof PhraseItemSchema>;

export const PhraseSchema = z.array(PhraseItemSchema).min(1).max(PHRASE_LIMITS.maxItems);

export const AddFavoriteSchema = z.object({ items: PhraseSchema }).strict();
export type AddFavorite = z.infer<typeof AddFavoriteSchema>;

export interface Favorite {
  id: string;
  items: PhraseItem[];
}

/** GET /api/favorites, in the order they were saved. */
export interface FavoriteList {
  favorites: Favorite[];
}

/** What a phrase says. */
export const phraseText = (items: readonly { label: string }[]) =>
  items.map((i) => i.label).join(' ');
