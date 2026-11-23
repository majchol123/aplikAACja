import {
  BOARD_LIMITS,
  HOME_NAME,
  type Board,
  type BoardChanges,
  type CreateHome,
  type CreateTile,
  type GridSize,
  type MoveTile,
  type PatchBoard,
  type PatchTile,
  type BoardPackage,
  type TemplateBoard,
  type Tile,
  isReservedCell,
  subtreePackage,
  treeShape,
} from '@aplikaacja/shared';
import { newId } from '../lib/crypto.ts';
import { loadTemplate } from './templates.ts';

export type BoardErrorCode =
  | 'not_found'
  | 'conflict'
  | 'already_initialized'
  | 'cell_occupied'
  | 'out_of_bounds'
  | 'invalid_move'
  | 'too_deep'
  | 'quota_exceeded'
  | 'unknown_symbol'
  | 'invalid_request'
  /** A package needs one free cell on the board it is placed on (F6). */
  | 'board_full';

export interface BoardError {
  error: BoardErrorCode;
}

/** Thrown inside a write transaction to roll it back and answer with `code`. */
class Abort extends Error {
  constructor(readonly code: BoardErrorCode) {
    super(code);
  }
}

type BoardRow = {
  id: string;
  name: string;
  parent_board_id: string | null;
  rows: number;
  cols: number;
  rev: number;
};

type TileRow = {
  id: string;
  board_id: string;
  row: number;
  col: number;
  kind: Tile['kind'];
  target_board_id: string | null;
  label: string;
  label_position: Tile['labelPosition'];
  font_size: Tile['fontSize'];
  color_role: Tile['colorRole'];
  color_mode: Tile['colorMode'];
  symbol_set: 'arasaac' | 'extra' | 'own' | null;
  symbol_ref: string | null;
  hidden: number;
  speech: string | null;
};

type MetaRow = { epoch: string; version: number; boards: number; tiles: number };

const BOARD_COLUMNS = 'id, name, parent_board_id, rows, cols, rev';
const TILE_COLUMNS =
  'id, board_id, row, col, kind, target_board_id, label, label_position, font_size, color_role, color_mode, symbol_set, symbol_ref, hidden, speech';

/** Recursion guard for tree queries; far above maxDepth, below SQLite's limits. */
const WALK_LIMIT = 64;

function toTile(row: TileRow): Tile {
  return {
    id: row.id,
    row: row.row,
    col: row.col,
    kind: row.kind,
    targetBoardId: row.target_board_id,
    label: row.label,
    labelPosition: row.label_position,
    fontSize: row.font_size,
    colorRole: row.color_role,
    colorMode: row.color_mode,
    symbol:
      row.symbol_set && row.symbol_ref !== null
        ? { set: row.symbol_set, ref: row.symbol_ref }
        : null,
    hidden: row.hidden === 1,
    speech: row.speech,
  };
}

const reserved = (board: BoardRow, row: number, col: number) =>
  isReservedCell({ parentId: board.parent_board_id }, { row, col });

function toBoard(row: BoardRow, tiles: Tile[]): Board {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_board_id,
    rows: row.rows,
    cols: row.cols,
    rev: row.rev,
    tiles,
  };
}

/** What one write did, collected while it runs and turned into BoardChanges at the end. */
class Changes {
  /** Existing boards whose revision goes up. */
  readonly bumped = new Set<string>();
  /** New boards (rev 1). */
  readonly created = new Set<string>();
  /** Answered as they are (a no-op write). */
  readonly unchanged = new Set<string>();
  readonly removed = new Set<string>();
  /** A folder changed parent: the tree shape must be re-validated before commit. */
  restructured = false;
}

/**
 * Board tree inside one UserVault. Callers pass input already validated by the shared Zod
 * schemas; everything that depends on stored state (revisions, cells, tree shape, quotas)
 * is checked here, inside the same synchronous transaction as the write.
 */
export class BoardStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  // --- reads -----------------------------------------------------------------------

  private meta(): MetaRow {
    return this.sql
      .exec<MetaRow>('SELECT epoch, version, boards, tiles FROM vault_meta WHERE id = 1')
      .one();
  }

  /** Weak validator of the whole tree; changes on every committed write. */
  etag(): string {
    const { epoch, version } = this.meta();
    return `W/"${epoch}.${version}"`;
  }

  /**
   * The whole tree as a JSON string (the Worker forwards it without re-parsing), or null
   * when `known` already contains the current ETag.
   */
  treeJson(known: readonly string[] = []): { etag: string; json: string | null } {
    const etag = this.etag();
    const opaque = etag.slice(2);
    if (known.some((tag) => tag === '*' || tag.replace(/^W\//, '') === opaque)) {
      return { etag, json: null };
    }
    const boards = this.sql.exec<BoardRow>(`SELECT ${BOARD_COLUMNS} FROM boards`).toArray();
    const tiles = this.tilesByBoard(
      this.sql
        .exec<TileRow>(`SELECT ${TILE_COLUMNS} FROM tiles ORDER BY board_id, row, col`)
        .toArray(),
    );
    const home = boards.find((b) => b.parent_board_id === null);
    return {
      etag,
      json: JSON.stringify({
        homeId: home?.id ?? null,
        boards: boards.map((b) => toBoard(b, tiles.get(b.id) ?? [])),
      }),
    };
  }

  private tilesByBoard(rows: TileRow[]): Map<string, Tile[]> {
    const out = new Map<string, Tile[]>();
    for (const row of rows) {
      const list = out.get(row.board_id);
      if (list) list.push(toTile(row));
      else out.set(row.board_id, [toTile(row)]);
    }
    return out;
  }

  private readBoards(ids: string[]): Board[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(', ');
    const boards = this.sql
      .exec<BoardRow>(`SELECT ${BOARD_COLUMNS} FROM boards WHERE id IN (${marks})`, ...ids)
      .toArray();
    const tiles = this.tilesByBoard(
      this.sql
        .exec<TileRow>(
          `SELECT ${TILE_COLUMNS} FROM tiles WHERE board_id IN (${marks}) ORDER BY board_id, row, col`,
          ...ids,
        )
        .toArray(),
    );
    return boards.map((b) => toBoard(b, tiles.get(b.id) ?? []));
  }

  private board(id: string): BoardRow | undefined {
    return this.sql
      .exec<BoardRow>(`SELECT ${BOARD_COLUMNS} FROM boards WHERE id = ?`, id)
      .toArray()[0];
  }

  private tile(id: string): TileRow | undefined {
    return this.sql
      .exec<TileRow>(`SELECT ${TILE_COLUMNS} FROM tiles WHERE id = ?`, id)
      .toArray()[0];
  }

  private tileAt(boardId: string, row: number, col: number): TileRow | undefined {
    return this.sql
      .exec<TileRow>(
        `SELECT ${TILE_COLUMNS} FROM tiles WHERE board_id = ? AND row = ? AND col = ?`,
        boardId,
        row,
        col,
      )
      .toArray()[0];
  }

  /** The board, if it exists and the caller saw its current revision. */
  private boardAt(id: string, rev: number | undefined): BoardRow {
    const board = this.board(id);
    if (!board) throw new Abort('not_found');
    if (rev === undefined) throw new Abort('invalid_request');
    if (board.rev !== rev) throw new Abort('conflict');
    return board;
  }

  /** Folder levels between the home board and `boardId` (home = 0). */
  private depth(boardId: string): number {
    return this.sql
      .exec<{ depth: number }>(
        `WITH RECURSIVE up (id, parent, depth) AS (
           SELECT id, parent_board_id, 0 FROM boards WHERE id = ?1
           UNION ALL
           SELECT b.id, b.parent_board_id, up.depth + 1
             FROM boards b JOIN up ON b.id = up.parent
            WHERE up.depth < ?2
         )
         SELECT MAX(depth) AS depth FROM up`,
        boardId,
        WALK_LIMIT,
      )
      .one().depth;
  }

  /** `rootId` and every board below it. */
  private subtree(rootId: string): string[] {
    return this.sql
      .exec<{ id: string }>(
        `WITH RECURSIVE down (id, depth) AS (
           SELECT ?1, 0
           UNION
           SELECT b.id, down.depth + 1
             FROM boards b JOIN down ON b.parent_board_id = down.id
            WHERE down.depth < ?2
         )
         SELECT DISTINCT id FROM down`,
        rootId,
        WALK_LIMIT,
      )
      .toArray()
      .map((r) => r.id);
  }

  /**
   * Every board reachable from home and no folder deeper than allowed. A cycle detaches
   * its boards from home, so the reachable count is enough to detect it.
   */
  private assertTree(): void {
    const walk = this.sql
      .exec<{ reached: number; depth: number | null }>(
        `WITH RECURSIVE down (id, depth) AS (
           SELECT id, 0 FROM boards WHERE parent_board_id IS NULL
           UNION
           SELECT b.id, down.depth + 1
             FROM boards b JOIN down ON b.parent_board_id = down.id
            WHERE down.depth < ?1
         )
         SELECT COUNT(DISTINCT id) AS reached, MAX(depth) AS depth FROM down`,
        WALK_LIMIT,
      )
      .one();
    if (walk.reached !== this.meta().boards) throw new Abort('invalid_move');
    if ((walk.depth ?? 0) > BOARD_LIMITS.maxDepth) throw new Abort('too_deep');
  }

  private assertInGrid(board: BoardRow, row: number, col: number): void {
    if (row >= board.rows || col >= board.cols) throw new Abort('out_of_bounds');
  }

  /** The home board's first cell is the app's "Wszystkie symbole" (isReservedCell). */
  private assertNotReserved(board: BoardRow, row: number, col: number): void {
    if (reserved(board, row, col)) throw new Abort('cell_occupied');
  }

  private assertQuota(newBoards: number, newTiles: number): void {
    const meta = this.meta();
    if (
      meta.boards + newBoards > BOARD_LIMITS.maxBoards ||
      meta.tiles + newTiles > BOARD_LIMITS.maxTiles
    ) {
      throw new Abort('quota_exceeded');
    }
  }

  private assertSymbol(symbol: Tile['symbol'] | undefined): void {
    if (symbol?.set !== 'own') return;
    const found = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM media WHERE id = ?', symbol.ref)
      .one().n;
    if (found === 0) throw new Abort('unknown_symbol');
  }

  // --- writes ----------------------------------------------------------------------

  /**
   * Runs `work` in one transaction. Any Abort rolls everything back; on success the
   * touched boards get a new revision, the tree ETag changes, and the caller receives the
   * current state of every affected board.
   */
  private write(work: (changes: Changes, now: number) => void): BoardChanges | BoardError {
    const changes = new Changes();
    const now = this.now();
    try {
      this.storage.transactionSync(() => {
        work(changes, now);
        for (const id of changes.bumped) {
          if (changes.created.has(id) || changes.removed.has(id)) continue;
          this.sql.exec('UPDATE boards SET rev = rev + 1, updated_at = ? WHERE id = ?', now, id);
        }
        if (changes.restructured) this.assertTree();
        if (changes.bumped.size + changes.created.size + changes.removed.size > 0) {
          this.sql.exec('UPDATE vault_meta SET version = version + 1 WHERE id = 1');
        }
      });
    } catch (err) {
      if (err instanceof Abort) return { error: err.code };
      throw err;
    }
    const ids = new Set([...changes.bumped, ...changes.created, ...changes.unchanged]);
    for (const id of changes.removed) ids.delete(id);
    return { boards: this.readBoards([...ids]), removed: [...changes.removed] };
  }

  private insertBoard(
    changes: Changes,
    now: number,
    name: string,
    parentId: string | null,
    grid: GridSize,
  ): string {
    const id = newId();
    this.sql.exec(
      `INSERT INTO boards (id, name, parent_board_id, rows, cols, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      name,
      parentId,
      grid.rows,
      grid.cols,
      now,
      now,
    );
    changes.created.add(id);
    return id;
  }

  /** New board opened by a folder tile on `parent`. */
  private createFolderBoard(
    changes: Changes,
    now: number,
    parent: BoardRow,
    name: string,
    grid: GridSize | undefined,
  ): string {
    if (this.depth(parent.id) + 1 > BOARD_LIMITS.maxDepth) throw new Abort('too_deep');
    return this.insertBoard(changes, now, name, parent.id, grid ?? parent);
  }

  /** Deletes `rootId` with all boards below it and the folder tile that opens it. */
  private removeSubtree(changes: Changes, rootId: string): void {
    for (const id of this.subtree(rootId)) changes.removed.add(id);
    this.sql.exec('DELETE FROM boards WHERE id = ?', rootId);
  }

  createHome(input: CreateHome): BoardChanges | BoardError {
    return this.write((changes, now) => {
      if (this.meta().boards > 0) throw new Abort('already_initialized');
      if ('template' in input) {
        const template = loadTemplate(input.template);
        const home = this.insertBoard(changes, now, HOME_NAME, null, template.board);
        this.seed(changes, now, home, template.board);
      } else {
        this.insertBoard(changes, now, HOME_NAME, null, input);
      }
    });
  }

  /** Template contents, already checked by templateProblems (bounds, cells, depth, size). */
  private seed(changes: Changes, now: number, boardId: string, board: TemplateBoard): void {
    for (const tile of board.tiles) {
      const target = tile.board
        ? this.insertBoard(changes, now, tile.label, boardId, tile.board)
        : null;
      this.insertTile(boardId, { ...tile, kind: tile.kind ?? 'word' }, target, now);
      if (tile.board && target) this.seed(changes, now, target, tile.board);
    }
  }

  private insertTile(
    boardId: string,
    tile: Omit<CreateTile, 'rev' | 'folder'>,
    target: string | null,
    now: number,
  ): void {
    this.sql.exec(
      `INSERT INTO tiles (id, board_id, row, col, kind, target_board_id, label, label_position,
                          font_size, color_role, color_mode, symbol_set, symbol_ref, hidden,
                          speech, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      boardId,
      tile.row,
      tile.col,
      tile.kind,
      target,
      tile.label,
      tile.labelPosition ?? 'bottom',
      tile.fontSize ?? 'M',
      tile.colorRole ?? null,
      tile.colorMode ?? 'border',
      tile.symbol?.set ?? null,
      tile.symbol?.ref ?? null,
      tile.hidden ? 1 : 0,
      tile.speech ?? null,
      now,
      now,
    );
  }

  patchBoard(id: string, input: PatchBoard): BoardChanges | BoardError {
    return this.write((changes, now) => {
      const board = this.boardAt(id, input.rev);
      // The home board keeps HOME_NAME.
      if (input.name !== undefined && board.parent_board_id === null) {
        throw new Abort('invalid_request');
      }
      const rows = input.rows ?? board.rows;
      const cols = input.cols ?? board.cols;
      if (rows < board.rows || cols < board.cols) {
        const cut = this.sql
          .exec<{ n: number }>(
            'SELECT COUNT(*) AS n FROM tiles WHERE board_id = ? AND (row >= ? OR col >= ?)',
            id,
            rows,
            cols,
          )
          .one().n;
        if (cut > 0) throw new Abort('out_of_bounds');
      }
      const name = input.name ?? board.name;
      this.sql.exec(
        'UPDATE boards SET name = ?, rows = ?, cols = ? WHERE id = ?',
        name,
        rows,
        cols,
        id,
      );
      changes.bumped.add(id);
      // A sub-board and the folder tile opening it share one name.
      if (input.name !== undefined && board.parent_board_id !== null) {
        this.sql.exec(
          'UPDATE tiles SET label = ?, updated_at = ? WHERE target_board_id = ?',
          name,
          now,
          id,
        );
        changes.bumped.add(board.parent_board_id);
      }
    });
  }

  createTile(boardId: string, input: CreateTile): BoardChanges | BoardError {
    return this.write((changes, now) => {
      const board = this.boardAt(boardId, input.rev);
      this.assertInGrid(board, input.row, input.col);
      this.assertNotReserved(board, input.row, input.col);
      if (this.tileAt(boardId, input.row, input.col)) throw new Abort('cell_occupied');
      this.assertQuota(input.kind === 'folder' ? 1 : 0, 1);
      this.assertSymbol(input.symbol);
      const target =
        input.kind === 'folder'
          ? this.createFolderBoard(changes, now, board, input.label, input.folder)
          : null;
      this.insertTile(boardId, input, target, now);
      changes.bumped.add(boardId);
    });
  }

  patchTile(tileId: string, input: PatchTile): BoardChanges | BoardError {
    return this.write((changes, now) => {
      const tile = this.tile(tileId);
      if (!tile) throw new Abort('not_found');
      const board = this.boardAt(tile.board_id, input.rev);
      const kind = input.kind ?? tile.kind;
      if (input.folder !== undefined && !(kind === 'folder' && tile.kind === 'word')) {
        throw new Abort('invalid_request'); // the grid applies to a newly created folder only
      }
      this.assertSymbol(input.symbol);
      const label = input.label ?? tile.label;

      let target = tile.target_board_id;
      if (kind === 'folder' && target === null) {
        this.assertQuota(1, 0);
        target = this.createFolderBoard(changes, now, board, label, input.folder);
      }
      const removedTarget = kind === 'word' ? tile.target_board_id : null;
      const { symbol } = input;
      this.sql.exec(
        `UPDATE tiles SET kind = ?, target_board_id = ?, label = ?, label_position = ?,
                          font_size = ?, color_role = ?, color_mode = ?, symbol_set = ?,
                          symbol_ref = ?, hidden = ?, speech = ?, updated_at = ?
          WHERE id = ?`,
        kind,
        kind === 'folder' ? target : null,
        label,
        input.labelPosition ?? tile.label_position,
        input.fontSize ?? tile.font_size,
        input.colorRole === undefined ? tile.color_role : input.colorRole,
        input.colorMode ?? tile.color_mode,
        symbol === undefined ? tile.symbol_set : (symbol?.set ?? null),
        symbol === undefined ? tile.symbol_ref : (symbol?.ref ?? null),
        input.hidden === undefined ? tile.hidden : input.hidden ? 1 : 0,
        input.speech === undefined ? tile.speech : input.speech,
        now,
        tileId,
      );
      changes.bumped.add(board.id);
      // Folder → word: the tile no longer references the sub-board, which goes with its subtree.
      if (removedTarget !== null) this.removeSubtree(changes, removedTarget);
      // Renaming a folder renames the board it opens.
      if (
        kind === 'folder' &&
        target !== null &&
        input.label !== undefined &&
        tile.kind === 'folder'
      ) {
        this.sql.exec('UPDATE boards SET name = ? WHERE id = ?', label, target);
        changes.bumped.add(target);
      }
    });
  }

  deleteTile(tileId: string, rev: number): BoardChanges | BoardError {
    return this.write((changes) => {
      const tile = this.tile(tileId);
      if (!tile) throw new Abort('not_found');
      this.boardAt(tile.board_id, rev);
      // Deleting the sub-board cascades to the folder tile itself.
      if (tile.target_board_id !== null) this.removeSubtree(changes, tile.target_board_id);
      this.sql.exec('DELETE FROM tiles WHERE id = ?', tileId);
      changes.bumped.add(tile.board_id);
    });
  }

  /** Moves a tile to a cell (any board); a tile already there takes the vacated cell. */
  moveTile(input: MoveTile): BoardChanges | BoardError {
    return this.write((changes, now) => {
      const tile = this.tile(input.tileId);
      if (!tile) throw new Abort('not_found');
      const from = this.boardAt(tile.board_id, input.rev);
      const to = input.toBoardId === from.id ? from : this.boardAt(input.toBoardId, input.toRev);
      this.assertInGrid(to, input.row, input.col);
      this.assertNotReserved(to, input.row, input.col);
      if (to.id === from.id && tile.row === input.row && tile.col === input.col) {
        changes.unchanged.add(from.id);
        return;
      }
      const other = this.tileAt(to.id, input.row, input.col);
      const place = (id: string, boardId: string, row: number, col: number) =>
        this.sql.exec(
          'UPDATE tiles SET board_id = ?, row = ?, col = ?, updated_at = ? WHERE id = ?',
          boardId,
          row,
          col,
          now,
          id,
        );
      const reparent = (folder: TileRow, parentId: string) => {
        if (folder.target_board_id === null || folder.board_id === parentId) return;
        this.sql.exec(
          'UPDATE boards SET parent_board_id = ? WHERE id = ?',
          parentId,
          folder.target_board_id,
        );
        changes.bumped.add(folder.target_board_id);
        changes.restructured = true;
      };
      if (other) {
        // Park the moving tile off-grid so the swap never violates UNIQUE (board, row, col).
        place(tile.id, from.id, -1, -1);
        place(other.id, from.id, tile.row, tile.col);
        reparent(other, from.id);
      }
      place(tile.id, to.id, input.row, input.col);
      reparent(tile, to.id);
      changes.bumped.add(from.id);
      changes.bumped.add(to.id);
    });
  }

  /**
   * Deletes an own photo. Tiles showing it keep their label only (their boards get a new
   * revision); preferred variants pointing to it are forgotten.
   */
  removeMedia(mediaId: string): BoardChanges | BoardError {
    return this.write((changes, now) => {
      if (this.sql.exec('SELECT 1 FROM media WHERE id = ?', mediaId).toArray().length === 0) {
        throw new Abort('not_found');
      }
      const boards = this.sql
        .exec<{ board_id: string }>(
          "SELECT DISTINCT board_id FROM tiles WHERE symbol_set = 'own' AND symbol_ref = ?",
          mediaId,
        )
        .toArray();
      for (const { board_id } of boards) changes.bumped.add(board_id);
      this.sql.exec(
        `UPDATE tiles SET symbol_set = NULL, symbol_ref = NULL, updated_at = ?
          WHERE symbol_set = 'own' AND symbol_ref = ?`,
        now,
        mediaId,
      );
      this.sql.exec(
        "DELETE FROM preferred_symbols WHERE symbol_set = 'own' AND symbol_ref = ?",
        mediaId,
      );
      this.sql.exec('DELETE FROM media WHERE id = ?', mediaId);
    });
  }

  // --- packages (F6, PLAN §2.8): a board with its sub-boards as one copyable unit ---------

  /**
   * The board `boardId` and everything below it as a package; `own` symbols keep the media
   * IDs of this vault (the caller attaches those photos). The look of the folder opening it
   * travels along (a home board has none).
   */
  exportPackage(
    boardId: string,
  ): { package: BoardPackage; boards: number; tiles: number; photoIds: string[] } | BoardError {
    if (!this.board(boardId)) return { error: 'not_found' };
    const boards = new Map(this.readBoards(this.subtree(boardId)).map((b) => [b.id, b]));
    const opener = this.sql
      .exec<TileRow>(`SELECT ${TILE_COLUMNS} FROM tiles WHERE target_board_id = ?`, boardId)
      .toArray()[0];
    return (
      subtreePackage(boards, boardId, opener ? toTile(opener) : null) ?? { error: 'not_found' }
    );
  }

  /**
   * Places a copy of `pkg` as a new folder in cell `at` of board `boardId` (it must be free)
   * or, without `at`, in the first free cell, in one transaction. `addPhotos` runs inside that transaction before the tiles are written:
   * it stores the package's photos and maps their keys to media IDs of this vault, or
   * returns null when the photo quota is exceeded (everything is rolled back). A photo
   * key it did not map leaves its tiles with their label only.
   */
  importPackage(
    boardId: string,
    rev: number,
    pkg: BoardPackage,
    addPhotos: () => Map<string, string> | null,
    at?: { row: number; col: number },
  ): BoardChanges | BoardError {
    return this.write((changes, now) => {
      const board = this.boardAt(boardId, rev);
      const shape = treeShape(pkg.board, pkg.name, { allowOwn: true });
      if (shape.problems.length > 0) throw new Abort('invalid_request');
      const taken = new Set(
        this.sql
          .exec<{ row: number; col: number }>(
            'SELECT row, col FROM tiles WHERE board_id = ?',
            board.id,
          )
          .toArray()
          .map((t) => `${t.row},${t.col}`),
      );
      let cell: { row: number; col: number } | undefined;
      if (at) {
        this.assertInGrid(board, at.row, at.col);
        this.assertNotReserved(board, at.row, at.col);
        if (taken.has(`${at.row},${at.col}`)) throw new Abort('cell_occupied');
        cell = at;
      }
      for (let i = 0; i < board.rows * board.cols && !cell; i++) {
        const row = Math.floor(i / board.cols);
        const col = i % board.cols;
        if (!taken.has(`${row},${col}`) && !reserved(board, row, col)) cell = { row, col };
      }
      if (!cell) throw new Abort('board_full');
      // The folder and the package's root board, then everything below it.
      this.assertQuota(shape.boards, shape.tiles + 1);
      if (this.depth(board.id) + 1 + shape.depth > BOARD_LIMITS.maxDepth) {
        throw new Abort('too_deep');
      }
      const ownIds = addPhotos();
      if (!ownIds) throw new Abort('quota_exceeded');
      const mapSymbol = (symbol: Tile['symbol'] | undefined): Tile['symbol'] => {
        if (symbol?.set !== 'own') return symbol ?? null;
        const id = ownIds.get(symbol.ref);
        return id ? { set: 'own', ref: id } : null;
      };
      const mapBoard = (b: TemplateBoard): TemplateBoard => ({
        rows: b.rows,
        cols: b.cols,
        tiles: b.tiles.map((t) => ({
          ...t,
          symbol: mapSymbol(t.symbol),
          ...(t.board ? { board: mapBoard(t.board) } : {}),
        })),
      });
      const tree = mapBoard(pkg.board);
      const target = this.insertBoard(changes, now, pkg.name, board.id, tree);
      this.insertTile(
        board.id,
        {
          row: cell.row,
          col: cell.col,
          kind: 'folder',
          label: pkg.name,
          ...pkg.tile,
          symbol: mapSymbol(pkg.tile?.symbol),
        },
        target,
        now,
      );
      this.seed(changes, now, target, tree);
      changes.bumped.add(board.id);
    });
  }

  /** Invariant violations (empty when healthy). Used by tests and future admin checks. */
  integrity(): string[] {
    const problems: string[] = [];
    const q = <T extends Record<string, SqlStorageValue>>(query: string) =>
      this.sql.exec<T>(query).toArray();
    const homes =
      q<{ n: number }>('SELECT COUNT(*) AS n FROM boards WHERE parent_board_id IS NULL')[0]?.n ?? 0;
    const counts = q<{ boards: number; tiles: number }>(
      'SELECT (SELECT COUNT(*) FROM boards) AS boards, (SELECT COUNT(*) FROM tiles) AS tiles',
    )[0];
    const meta = this.meta();
    if (counts && counts.boards > 0 && homes !== 1) problems.push(`homes=${homes}`);
    for (const r of this.sql
      .exec<{ name: string }>(
        'SELECT name FROM boards WHERE parent_board_id IS NULL AND name != ?',
        HOME_NAME,
      )
      .toArray()) {
      problems.push(`home board named ${JSON.stringify(r.name)}`);
    }
    if (counts && (counts.boards !== meta.boards || counts.tiles !== meta.tiles)) {
      problems.push(`counters ${meta.boards}/${meta.tiles} != ${counts.boards}/${counts.tiles}`);
    }
    for (const r of q<{ id: string }>(
      `SELECT b.id FROM boards b LEFT JOIN tiles t ON t.target_board_id = b.id
        WHERE b.parent_board_id IS NOT NULL AND (t.id IS NULL OR t.board_id != b.parent_board_id)`,
    )) {
      problems.push(`board ${r.id}: folder tile missing or on another board`);
    }
    for (const r of q<{ id: string }>(
      `SELECT t.id FROM tiles t JOIN boards b ON b.id = t.board_id
        WHERE t.row < 0 OR t.col < 0 OR t.row >= b.rows OR t.col >= b.cols`,
    )) {
      problems.push(`tile ${r.id}: outside the grid`);
    }
    for (const r of q<{ id: string }>(
      `SELECT t.id FROM tiles t JOIN boards b ON b.id = t.board_id
        WHERE b.parent_board_id IS NULL AND t.row = 0 AND t.col = 0`,
    )) {
      problems.push(`tile ${r.id}: in the home board's reserved first cell`);
    }
    if (counts && counts.boards > 0) {
      try {
        this.assertTree();
      } catch (err) {
        problems.push(`tree: ${err instanceof Abort ? err.code : String(err)}`);
      }
    }
    return problems;
  }
}
