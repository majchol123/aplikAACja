import { z } from 'zod';
import { SymbolRefSchema, TileLabelSchema, TileSpeechSchema } from './boards.ts';

/**
 * Phrases of communication mode (PLAN §2.1): the last utterances and the favourites are
 * saved on the account so every device has them. The history can be switched off
 * (Settings.keepHistory); devices send it in batches to spare the request budget.
 */
export const PHRASE_LIMITS = {
  /** Words of one phrase (the sentence bar holds at most as many). */
  maxItems: 30,
  maxFavorites: 200,
  historySize: 50,
} as const;

export const PhraseItemSchema = z
  .object({
    label: TileLabelSchema,
    symbol: SymbolRefSchema.nullable(),
    /** What the tile said instead of its label (Tile.speech). */
    speech: TileSpeechSchema.optional(),
  })
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

/** One utterance of the history; `at` in ms. */
export const HistoryItemSchema = z
  .object({ at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), items: PhraseSchema })
  .strict();

/** POST /api/history: utterances a device collected since its last batch. */
export const AddHistorySchema = z
  .object({ entries: z.array(HistoryItemSchema).min(1).max(PHRASE_LIMITS.historySize) })
  .strict();
export type AddHistory = z.infer<typeof AddHistorySchema>;

export interface HistoryEntry {
  at: number;
  items: PhraseItem[];
}

/** GET /api/history (and the answer to POST): newest first, the same words once. */
export interface HistoryList {
  entries: HistoryEntry[];
}

/** What a phrase shows (the labels). */
export const phraseText = (items: readonly { label: string }[]) =>
  items.map((i) => i.label).join(' ');

/** What a phrase says: a tile's own words where it has them, else its label. */
export const spokenText = (items: readonly { label: string; speech?: string | null }[]) =>
  items.map((i) => i.speech ?? i.label).join(' ');
