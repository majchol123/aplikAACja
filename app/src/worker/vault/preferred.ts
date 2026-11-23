import {
  PREFERRED_LIMIT,
  preferredKey,
  SymbolRefSchema,
  type PreferredSymbol,
  type PutPreferred,
} from '@aplikaacja/shared';

export type PreferredError = { error: 'quota_exceeded' | 'unknown_symbol' };

/** Preferred symbol variants (PLAN §2.2) in the vault's preferred_symbols table. */
export class PreferredStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  list(): PreferredSymbol[] {
    const items: PreferredSymbol[] = [];
    for (const row of this.storage.sql.exec<{
      word_norm: string;
      symbol_set: string;
      symbol_ref: string;
    }>('SELECT word_norm, symbol_set, symbol_ref FROM preferred_symbols ORDER BY word_norm')) {
      // Rows written by older code that no longer validate are skipped, not served.
      const symbol = SymbolRefSchema.safeParse({ set: row.symbol_set, ref: row.symbol_ref });
      if (symbol.success) items.push({ word: row.word_norm, symbol: symbol.data });
    }
    return items;
  }

  /** `input` must already be validated with PutPreferredSchema. Insert or replace. */
  put(input: PutPreferred): PreferredSymbol | PreferredError {
    const sql = this.storage.sql;
    const word = preferredKey(input.word);
    return this.storage.transactionSync(() => {
      if (
        input.symbol.set === 'own' &&
        sql.exec('SELECT 1 FROM media WHERE id = ?', input.symbol.ref).toArray().length === 0
      ) {
        return { error: 'unknown_symbol' } as const;
      }
      const exists = sql
        .exec('SELECT 1 FROM preferred_symbols WHERE word_norm = ?', word)
        .toArray().length;
      if (!exists) {
        const { preferred } = sql
          .exec<{ preferred: number }>('SELECT preferred FROM vault_meta WHERE id = 1')
          .one();
        if (preferred >= PREFERRED_LIMIT) return { error: 'quota_exceeded' } as const;
      }
      sql.exec(
        `INSERT INTO preferred_symbols (word_norm, symbol_set, symbol_ref) VALUES (?, ?, ?)
           ON CONFLICT (word_norm) DO UPDATE
           SET symbol_set = excluded.symbol_set, symbol_ref = excluded.symbol_ref`,
        word,
        input.symbol.set,
        input.symbol.ref,
      );
      return { word, symbol: input.symbol };
    });
  }
}
