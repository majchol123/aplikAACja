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

  // v2 — board tree (F2). No code before v2 ever wrote boards or tiles, so the v1 tables are
  // empty and can be recreated with the final constraints:
  //  - one home board (the only one without a parent, enforced by a partial unique index),
  //  - each other board opened by exactly one folder tile (UNIQUE target_board_id),
  //  - deleting a board cascades to its tiles, its sub-boards and the folder tile opening it,
  //  - board-level `rev` for optimistic concurrency (tiles have none of their own),
  //  - vault_meta: tree version (ETag) and row counts kept by triggers, so quota checks
  //    never scan the tables (rows read are billed).
  `DROP TABLE tiles;
   DROP TABLE boards;
   CREATE TABLE boards (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     parent_board_id TEXT REFERENCES boards (id) ON DELETE CASCADE,
     rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND 12),
     cols INTEGER NOT NULL CHECK (cols BETWEEN 1 AND 12),
     rev INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX idx_boards_parent ON boards (parent_board_id);
   CREATE UNIQUE INDEX idx_boards_home ON boards ((parent_board_id IS NULL))
     WHERE parent_board_id IS NULL;
   CREATE TABLE tiles (
     id TEXT PRIMARY KEY,
     board_id TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
     row INTEGER NOT NULL,
     col INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('word', 'folder')),
     target_board_id TEXT UNIQUE REFERENCES boards (id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     label_position TEXT NOT NULL DEFAULT 'bottom' CHECK (label_position IN ('top', 'bottom')),
     font_size TEXT NOT NULL DEFAULT 'M' CHECK (font_size IN ('S', 'M', 'L', 'XL')),
     color_role TEXT CHECK (color_role IN
       ('person', 'noun', 'verb', 'descriptor', 'social', 'question', 'negation', 'misc')),
     color_mode TEXT NOT NULL DEFAULT 'border' CHECK (color_mode IN ('background', 'border')),
     symbol_set TEXT CHECK (symbol_set IN ('arasaac', 'extra', 'own')),
     symbol_ref TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (board_id, row, col),
     CHECK ((kind = 'folder') = (target_board_id IS NOT NULL)),
     CHECK ((symbol_set IS NULL) = (symbol_ref IS NULL))
   );
   CREATE TABLE vault_meta (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     epoch TEXT NOT NULL,
     version INTEGER NOT NULL,
     boards INTEGER NOT NULL,
     tiles INTEGER NOT NULL
   );
   INSERT INTO vault_meta (id, epoch, version, boards, tiles)
     VALUES (1, lower(hex(randomblob(8))), 0, 0, 0);
   CREATE TRIGGER boards_counted AFTER INSERT ON boards
     BEGIN UPDATE vault_meta SET boards = boards + 1 WHERE id = 1; END;
   CREATE TRIGGER boards_uncounted AFTER DELETE ON boards
     BEGIN UPDATE vault_meta SET boards = boards - 1 WHERE id = 1; END;
   CREATE TRIGGER tiles_counted AFTER INSERT ON tiles
     BEGIN UPDATE vault_meta SET tiles = tiles + 1 WHERE id = 1; END;
   CREATE TRIGGER tiles_uncounted AFTER DELETE ON tiles
     BEGIN UPDATE vault_meta SET tiles = tiles - 1 WHERE id = 1; END;`,
];

export function migrateVault(storage: DurableObjectStorage): number {
  const sql = storage.sql;
  sql.exec(
    'CREATE TABLE IF NOT EXISTS _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
  );
  const current =
    sql.exec<{ version: number }>('SELECT version FROM _schema WHERE id = 1').toArray()[0]
      ?.version ?? 0;
  if (current >= VAULT_MIGRATIONS.length) {
    // Newer schema after a code rollback: migrations are backward compatible, keep going.
    if (current > VAULT_MIGRATIONS.length) {
      console.warn(JSON.stringify({ msg: 'vault schema newer than code', current }));
    }
    return current;
  }
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
