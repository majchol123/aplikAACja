import {
  PHRASE_LIMITS,
  PhraseSchema,
  phraseText,
  type HistoryEntry,
  type PhraseItem,
} from '@relaacja/shared';

type Row = { items: string; at: number };

/**
 * The last utterances of the account (vault table `history`, since v8), newest first. A
 * phrase said again moves to the top instead of repeating; only the newest
 * PHRASE_LIMITS.historySize are kept.
 */
export class HistoryStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  list(): HistoryEntry[] {
    return this.sql
      .exec<Row>(
        'SELECT items, at FROM history ORDER BY at DESC, text LIMIT ?',
        PHRASE_LIMITS.historySize,
      )
      .toArray()
      .flatMap((row) => {
        // Values written by older code may no longer validate: such a phrase is skipped.
        try {
          const items = PhraseSchema.safeParse(JSON.parse(row.items));
          return items.success ? [{ at: row.at, items: items.data }] : [];
        } catch {
          return [];
        }
      });
  }

  /** A batch from one device; times from the future count as now. */
  add(entries: readonly { at: number; items: PhraseItem[] }[], now: number): HistoryEntry[] {
    this.storage.transactionSync(() => {
      for (const entry of entries) {
        this.sql.exec(
          `INSERT INTO history (text, items, at) VALUES (?, ?, ?)
           ON CONFLICT (text) DO UPDATE SET items = excluded.items, at = excluded.at
            WHERE excluded.at >= history.at`,
          phraseText(entry.items),
          JSON.stringify(entry.items),
          Math.min(entry.at, now),
        );
      }
      this.sql.exec(
        `DELETE FROM history WHERE text NOT IN
           (SELECT text FROM history ORDER BY at DESC, text LIMIT ?)`,
        PHRASE_LIMITS.historySize,
      );
    });
    return this.list();
  }

  clear(): void {
    this.sql.exec('DELETE FROM history');
  }
}
