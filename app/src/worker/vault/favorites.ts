import {
  PHRASE_LIMITS,
  PhraseSchema,
  phraseText,
  type Favorite,
  type PhraseItem,
} from '@aplikaacja/shared';
import { newId } from '../lib/crypto.ts';

type Row = { id: string; items: string };

/** Values written by older code may no longer validate: such a phrase is skipped. */
function toFavorite(row: Row): Favorite | null {
  try {
    const items = PhraseSchema.safeParse(JSON.parse(row.items));
    return items.success ? { id: row.id, items: items.data } : null;
  } catch {
    return null;
  }
}

/** Favourite phrases of the account (vault table `favorites`, empty since v1). */
export class FavoriteStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  list(): Favorite[] {
    return this.sql
      .exec<Row>('SELECT id, items FROM favorites ORDER BY position, id')
      .toArray()
      .flatMap((row) => toFavorite(row) ?? []);
  }

  /** Saved once: the same words again give back the saved phrase. */
  add(items: PhraseItem[]): Favorite | { error: 'quota_exceeded' } {
    return this.storage.transactionSync(() => {
      const all = this.list();
      const text = phraseText(items);
      const same = all.find((f) => phraseText(f.items) === text);
      if (same) return same;
      if (all.length >= PHRASE_LIMITS.maxFavorites) return { error: 'quota_exceeded' } as const;
      const position =
        this.sql.exec<{ p: number | null }>('SELECT MAX(position) AS p FROM favorites').one().p ??
        0;
      const favorite: Favorite = { id: newId(), items };
      this.sql.exec(
        'INSERT INTO favorites (id, name, items, position) VALUES (?, NULL, ?, ?)',
        favorite.id,
        JSON.stringify(items),
        position + 1,
      );
      return favorite;
    });
  }

  remove(id: string): boolean {
    return (
      this.sql.exec('DELETE FROM favorites WHERE id = ? RETURNING id', id).toArray().length > 0
    );
  }
}
