/**
 * Forward-only schema migrations of the per-user SQLite database. Applied lazily on the
 * first access of each Durable Object (inside blockConcurrencyWhile), so every migration
 * must stay backward compatible with the currently deployed code.
 */
export const VAULT_MIGRATIONS: readonly string[] = [
  // v1
  `CREATE TABLE boards (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     parent_board_id TEXT REFERENCES boards (id),
     rows INTEGER NOT NULL,
     cols INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     rev INTEGER NOT NULL DEFAULT 1
   );
   CREATE TABLE tiles (
     id TEXT PRIMARY KEY,
     board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     row INTEGER NOT NULL,
     col INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('word', 'folder')),
     target_board_id TEXT REFERENCES boards (id),
     label TEXT NOT NULL,
     label_position TEXT NOT NULL DEFAULT 'bottom' CHECK (label_position IN ('top', 'bottom')),
     font_size TEXT NOT NULL DEFAULT 'M' CHECK (font_size IN ('S', 'M', 'L', 'XL')),
     color_role TEXT,
     color_mode TEXT NOT NULL DEFAULT 'border' CHECK (color_mode IN ('background', 'border')),
     symbol_set TEXT NOT NULL CHECK (symbol_set IN ('arasaac', 'extra', 'own')),
     symbol_ref TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     rev INTEGER NOT NULL DEFAULT 1,
     UNIQUE (board_id, row, col)
   );
   CREATE INDEX idx_tiles_board ON tiles (board_id);
   CREATE TABLE media (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     mime TEXT NOT NULL,
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     data BLOB NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE preferred_symbols (
     word_norm TEXT PRIMARY KEY,
     symbol_set TEXT NOT NULL,
     symbol_ref TEXT NOT NULL
   );
   CREATE TABLE phrase_history (id TEXT PRIMARY KEY, at INTEGER NOT NULL, items TEXT NOT NULL);
   CREATE TABLE favorites (id TEXT PRIMARY KEY, name TEXT, items TEXT NOT NULL, position INTEGER NOT NULL);`,
];

export function migrateVault(storage: DurableObjectStorage): number {
  const sql = storage.sql;
  sql.exec(
    'CREATE TABLE IF NOT EXISTS _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
  );
  const current =
    sql.exec<{ version: number }>('SELECT version FROM _schema WHERE id = 1').toArray()[0]
      ?.version ?? 0;
  if (current > VAULT_MIGRATIONS.length) {
    throw new Error(`vault schema v${current} is newer than code (v${VAULT_MIGRATIONS.length})`);
  }
  if (current === VAULT_MIGRATIONS.length) return current;
  storage.transactionSync(() => {
    for (const migration of VAULT_MIGRATIONS.slice(current)) {
      sql.exec(migration);
    }
    sql.exec(
      'INSERT INTO _schema (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version',
      VAULT_MIGRATIONS.length,
    );
  });
  return VAULT_MIGRATIONS.length;
}
