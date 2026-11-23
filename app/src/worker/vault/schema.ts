import { BOARD_LIMITS } from '@aplikaacja/shared';

/** SQL, or code for a data change SQL alone cannot express; both run in one transaction. */
export type Migration = string | ((sql: SqlStorage) => void);

export function applyMigration(sql: SqlStorage, migration: Migration): void {
  if (typeof migration === 'string') sql.exec(migration);
  else migration(sql);
}

/**
 * v10 — the home board's first cell becomes the app's folder "Wszystkie symbole"
 * (isReservedCell). A tile already there moves to the first free cell of the home board in
 * reading order, or to a new last row when the board is full (at the row limit it stays,
 * and the app shows it instead of the folder). The board gets a new revision.
 */
function freeReservedCell(sql: SqlStorage): void {
  const home = sql
    .exec<{ id: string; rows: number; cols: number }>(
      'SELECT id, rows, cols FROM boards WHERE parent_board_id IS NULL',
    )
    .toArray()[0];
  if (!home) return;
  const there = sql
    .exec<{ id: string }>(
      'SELECT id FROM tiles WHERE board_id = ? AND row = 0 AND col = 0',
      home.id,
    )
    .toArray()[0];
  if (!there) return;
  const taken = new Set(
    sql
      .exec<{ row: number; col: number }>('SELECT row, col FROM tiles WHERE board_id = ?', home.id)
      .toArray()
      .map((t) => `${t.row},${t.col}`),
  );
  let cell: { row: number; col: number } | null = null;
  for (let i = 1; i < home.rows * home.cols && !cell; i++) {
    const row = Math.floor(i / home.cols);
    const col = i % home.cols;
    if (!taken.has(`${row},${col}`)) cell = { row, col };
  }
  const now = Date.now();
  if (!cell) {
    if (home.rows >= BOARD_LIMITS.maxRows) return;
    cell = { row: home.rows, col: 0 };
    sql.exec('UPDATE boards SET rows = rows + 1 WHERE id = ?', home.id);
  }
  sql.exec(
    'UPDATE tiles SET row = ?, col = ?, updated_at = ? WHERE id = ?',
    cell.row,
    cell.col,
    now,
    there.id,
  );
  sql.exec('UPDATE boards SET rev = rev + 1, updated_at = ? WHERE id = ?', now, home.id);
  sql.exec('UPDATE vault_meta SET version = version + 1 WHERE id = 1');
}

/**
 * Forward-only schema migrations of the per-user SQLite database. Applied lazily on the
 * first access of each Durable Object (inside blockConcurrencyWhile), so every migration
 * must stay backward compatible with the currently deployed code.
 */
export const VAULT_MIGRATIONS: readonly Migration[] = [
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

  // v3 — preferred symbol variants (F2 step 3): row count kept by triggers like boards/tiles.
  `ALTER TABLE vault_meta ADD COLUMN preferred INTEGER NOT NULL DEFAULT 0;
   UPDATE vault_meta SET preferred = (SELECT COUNT(*) FROM preferred_symbols) WHERE id = 1;
   CREATE TRIGGER preferred_counted AFTER INSERT ON preferred_symbols
     BEGIN UPDATE vault_meta SET preferred = preferred + 1 WHERE id = 1; END;
   CREATE TRIGGER preferred_uncounted AFTER DELETE ON preferred_symbols
     BEGIN UPDATE vault_meta SET preferred = preferred - 1 WHERE id = 1; END;`,

  // v4 — own photos (F2 step 4). No code before v4 wrote media, so the v1 table is empty
  // and is recreated with the picture bytes in a table of their own: listing photos then
  // never walks through BLOB overflow pages. Count and bytes kept by triggers for the
  // quota check; partial indexes find the tiles and preferred variants showing a photo.
  `DROP TABLE media;
   CREATE TABLE media (
     id TEXT PRIMARY KEY,
     label TEXT NOT NULL,
     mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
     width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 512),
     height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 512),
     bytes INTEGER NOT NULL CHECK (bytes > 0),
     sha256 TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_media_created ON media (created_at);
   CREATE TABLE media_data (
     id TEXT PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
     data BLOB NOT NULL
   );
   ALTER TABLE vault_meta ADD COLUMN media INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE vault_meta ADD COLUMN media_bytes INTEGER NOT NULL DEFAULT 0;
   CREATE TRIGGER media_counted AFTER INSERT ON media
     BEGIN UPDATE vault_meta SET media = media + 1, media_bytes = media_bytes + NEW.bytes WHERE id = 1; END;
   CREATE TRIGGER media_uncounted AFTER DELETE ON media
     BEGIN UPDATE vault_meta SET media = media - 1, media_bytes = media_bytes - OLD.bytes WHERE id = 1; END;
   CREATE INDEX idx_tiles_own ON tiles (symbol_ref) WHERE symbol_set = 'own';
   CREATE INDEX idx_preferred_own ON preferred_symbols (symbol_ref) WHERE symbol_set = 'own';`,

  // v5 — sharing boards between accounts (F6, PLAN §2.8). Inbox: packages other accounts
  // sent, with their photos, until accepted, rejected or expired; the sender is kept by ID
  // only (name and address come from D1 when listed, so a deleted sender leaves nothing).
  // Outbox: what this account sent, as it typed the address, and the recipient's decision.
  // Sends per day are counted in vault_meta.
  `CREATE TABLE inbox (
     id TEXT PRIMARY KEY,
     sender_id TEXT NOT NULL,
     share_id TEXT NOT NULL,
     name TEXT NOT NULL,
     package TEXT NOT NULL,
     boards INTEGER NOT NULL,
     tiles INTEGER NOT NULL,
     photos INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX idx_inbox_expires ON inbox (expires_at);
   CREATE TABLE inbox_media (
     inbox_id TEXT NOT NULL REFERENCES inbox (id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     label TEXT NOT NULL,
     mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     data BLOB NOT NULL,
     PRIMARY KEY (inbox_id, key)
   );
   CREATE TABLE outbox (
     id TEXT PRIMARY KEY,
     recipient TEXT NOT NULL,
     name TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
     boards INTEGER NOT NULL,
     tiles INTEGER NOT NULL,
     photos INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     decided_at INTEGER
   );
   CREATE INDEX idx_outbox_created ON outbox (created_at);
   CREATE INDEX idx_media_sha256 ON media (sha256);
   ALTER TABLE vault_meta ADD COLUMN sends_day TEXT NOT NULL DEFAULT '';
   ALTER TABLE vault_meta ADD COLUMN sends INTEGER NOT NULL DEFAULT 0;`,

  // v6 — hidden tiles (backlog): out of communication mode but kept in their cell, so the
  // other tiles never move (motor planning); shown dimmed in edit mode.
  `ALTER TABLE tiles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));`,

  // v7 — what a tile says instead of its label (backlog); NULL says the label.
  `ALTER TABLE tiles ADD COLUMN speech TEXT;`,
  // v8 — the last utterances on the account (history.ts); the same words once.
  `CREATE TABLE history (
     text TEXT PRIMARY KEY,
     items TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX history_at ON history (at);`,

  // v9 — taller boards (up to 40 rows, scrolled; BOARD_LIMITS). SQLite cannot change a CHECK,
  // so both tables are rebuilt: dropping `boards` alone would cascade into `tiles`, and
  // ON DELETE CASCADE runs even with deferred foreign keys. The old tiles go first (nothing
  // references them), then the old boards; renaming the copies rewrites the REFERENCES
  // clauses that name them. Dropping a table drops its indexes and triggers, so both come
  // back as in v2/v4, and the counters are recounted rather than trusted.
  `CREATE TABLE boards_v9 (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     parent_board_id TEXT REFERENCES boards_v9 (id) ON DELETE CASCADE,
     rows INTEGER NOT NULL CHECK (rows BETWEEN 1 AND 40),
     cols INTEGER NOT NULL CHECK (cols BETWEEN 1 AND 12),
     rev INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   INSERT INTO boards_v9 (id, name, parent_board_id, rows, cols, rev, created_at, updated_at)
     SELECT id, name, parent_board_id, rows, cols, rev, created_at, updated_at FROM boards;
   CREATE TABLE tiles_v9 (
     id TEXT PRIMARY KEY,
     board_id TEXT NOT NULL REFERENCES boards_v9 (id) ON DELETE CASCADE,
     row INTEGER NOT NULL,
     col INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('word', 'folder')),
     target_board_id TEXT UNIQUE REFERENCES boards_v9 (id) ON DELETE CASCADE,
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
     hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
     speech TEXT,
     UNIQUE (board_id, row, col),
     CHECK ((kind = 'folder') = (target_board_id IS NOT NULL)),
     CHECK ((symbol_set IS NULL) = (symbol_ref IS NULL))
   );
   INSERT INTO tiles_v9 (id, board_id, row, col, kind, target_board_id, label, label_position,
                         font_size, color_role, color_mode, symbol_set, symbol_ref, created_at,
                         updated_at, hidden, speech)
     SELECT id, board_id, row, col, kind, target_board_id, label, label_position, font_size,
            color_role, color_mode, symbol_set, symbol_ref, created_at, updated_at, hidden, speech
       FROM tiles;
   DROP TABLE tiles;
   DROP TABLE boards;
   ALTER TABLE boards_v9 RENAME TO boards;
   ALTER TABLE tiles_v9 RENAME TO tiles;
   CREATE INDEX idx_boards_parent ON boards (parent_board_id);
   CREATE UNIQUE INDEX idx_boards_home ON boards ((parent_board_id IS NULL))
     WHERE parent_board_id IS NULL;
   CREATE INDEX idx_tiles_own ON tiles (symbol_ref) WHERE symbol_set = 'own';
   CREATE TRIGGER boards_counted AFTER INSERT ON boards
     BEGIN UPDATE vault_meta SET boards = boards + 1 WHERE id = 1; END;
   CREATE TRIGGER boards_uncounted AFTER DELETE ON boards
     BEGIN UPDATE vault_meta SET boards = boards - 1 WHERE id = 1; END;
   CREATE TRIGGER tiles_counted AFTER INSERT ON tiles
     BEGIN UPDATE vault_meta SET tiles = tiles + 1 WHERE id = 1; END;
   CREATE TRIGGER tiles_uncounted AFTER DELETE ON tiles
     BEGIN UPDATE vault_meta SET tiles = tiles - 1 WHERE id = 1; END;
   UPDATE vault_meta
      SET boards = (SELECT COUNT(*) FROM boards), tiles = (SELECT COUNT(*) FROM tiles)
    WHERE id = 1;`,

  // v10 — "Wszystkie symbole" in the home board's first cell (see freeReservedCell).
  freeReservedCell,
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
      applyMigration(sql, migration);
    }
    sql.exec(
      'INSERT INTO _schema (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version',
      VAULT_MIGRATIONS.length,
    );
  });
  return VAULT_MIGRATIONS.length;
}
