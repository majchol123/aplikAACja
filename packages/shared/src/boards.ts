import { z } from 'zod';
import { FitzgeraldRoleSchema, type FitzgeraldRole } from './symbols.ts';
import type { SymbolSet } from './settings.ts';

/**
 * Boards and tiles (PLAN §3.5). The board tree is strict: the home board has no parent,
 * every other board is reached through exactly one folder tile on its parent board, so
 * the server can rule out cycles and orphans by construction.
 */
export const BOARD_LIMITS = {
  maxRows: 12,
  maxCols: 12,
  /** Folder levels below the home board. */
  maxDepth: 10,
  maxBoards: 500,
  maxTiles: 20_000,
  nameMax: 60,
  labelMax: 80,
} as const;

export const TILE_KINDS = ['word', 'folder'] as const;
export const LABEL_POSITIONS = ['top', 'bottom'] as const;
export const FONT_SIZES = ['S', 'M', 'L', 'XL'] as const;
export const COLOR_MODES = ['background', 'border'] as const;

export type TileKind = (typeof TILE_KINDS)[number];
export type LabelPosition = (typeof LABEL_POSITIONS)[number];
export type FontSize = (typeof FONT_SIZES)[number];
export type ColorMode = (typeof COLOR_MODES)[number];

/** Vault object ID: 128 random bits, lowercase base32 (see worker/lib/crypto.ts newId). */
export const ObjectIdSchema = z.string().regex(/^[a-z2-7]{26}$/);

const text = (max: number) =>
  z
    .string()
    .normalize('NFC')
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\p{Cc}\p{Cs}\u2028\u2029]/u.test(s), 'control characters');

export const BoardNameSchema = text(BOARD_LIMITS.nameMax);
export const TileLabelSchema = text(BOARD_LIMITS.labelMax);

const libraryRef = z.string().regex(/^(0|[1-9][0-9]{0,9})$/);

/** A tile's picture: library symbol by ID, or an own photo by media ID. */
export const SymbolRefSchema = z.discriminatedUnion('set', [
  z.object({ set: z.literal('arasaac'), ref: libraryRef }).strict(),
  z.object({ set: z.literal('extra'), ref: libraryRef }).strict(),
  z.object({ set: z.literal('own'), ref: ObjectIdSchema }).strict(),
]);
export type SymbolRef = z.infer<typeof SymbolRefSchema>;

const RevSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const rowsSchema = z.number().int().min(1).max(BOARD_LIMITS.maxRows);
const colsSchema = z.number().int().min(1).max(BOARD_LIMITS.maxCols);
const rowSchema = z
  .number()
  .int()
  .min(0)
  .max(BOARD_LIMITS.maxRows - 1);
const colSchema = z
  .number()
  .int()
  .min(0)
  .max(BOARD_LIMITS.maxCols - 1);

export const GridSizeSchema = z.object({ rows: rowsSchema, cols: colsSchema }).strict();
export type GridSize = z.infer<typeof GridSizeSchema>;

const tileStyle = {
  labelPosition: z.enum(LABEL_POSITIONS),
  fontSize: z.enum(FONT_SIZES),
  colorRole: FitzgeraldRoleSchema.nullable(),
  colorMode: z.enum(COLOR_MODES),
  symbol: SymbolRefSchema.nullable(),
};

/** Bundled board templates (templates/*.json), created in one server-side transaction. */
export const TEMPLATES = ['starter'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

/** An empty home board, or one built from a bundled template. */
export const CreateHomeSchema = z.union([
  z.object({ name: BoardNameSchema, rows: rowsSchema, cols: colsSchema }).strict(),
  z.object({ template: z.enum(TEMPLATES) }).strict(),
]);
export type CreateHome = z.infer<typeof CreateHomeSchema>;

const TemplateTileSchema = z
  .object({
    row: rowSchema,
    col: colSchema,
    kind: z.enum(TILE_KINDS).optional(),
    label: TileLabelSchema,
    labelPosition: tileStyle.labelPosition.optional(),
    fontSize: tileStyle.fontSize.optional(),
    colorRole: tileStyle.colorRole.optional(),
    colorMode: tileStyle.colorMode.optional(),
    symbol: tileStyle.symbol.optional(),
    /** Contents of the board a folder opens (folders only). */
    get board() {
      return TemplateBoardSchema.optional();
    },
  })
  .strict();

const TemplateBoardSchema = z
  .object({
    rows: rowsSchema,
    cols: colsSchema,
    get tiles() {
      return z.array(TemplateTileSchema);
    },
  })
  .strict();

export const TemplateSchema = z
  .object({ v: z.literal(1), name: BoardNameSchema, board: TemplateBoardSchema })
  .strict();
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateBoard = z.infer<typeof TemplateBoardSchema>;

/** `rev` is the board's current revision; a stale one is refused with 409 (PLAN §3.5). */
export const PatchBoardSchema = z
  .object({
    rev: RevSchema,
    name: BoardNameSchema.optional(),
    rows: rowsSchema.optional(),
    cols: colsSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 1, 'nothing to change');
export type PatchBoard = z.infer<typeof PatchBoardSchema>;

export const CreateTileSchema = z
  .object({
    rev: RevSchema,
    row: rowSchema,
    col: colSchema,
    kind: z.enum(TILE_KINDS),
    label: TileLabelSchema,
    labelPosition: tileStyle.labelPosition.optional(),
    fontSize: tileStyle.fontSize.optional(),
    colorRole: tileStyle.colorRole.optional(),
    colorMode: tileStyle.colorMode.optional(),
    symbol: tileStyle.symbol.optional(),
    /** Grid of the board a folder opens; defaults to the parent board's grid. */
    folder: GridSizeSchema.optional(),
  })
  .strict()
  .refine((t) => t.kind === 'folder' || t.folder === undefined, 'folder grid on a word tile');
export type CreateTile = z.infer<typeof CreateTileSchema>;

/**
 * `rev` is the revision of the tile's board. Changing `kind` to 'word' deletes the folder's
 * whole subtree; changing it to 'folder' creates an empty board.
 */
export const PatchTileSchema = z
  .object({
    rev: RevSchema,
    kind: z.enum(TILE_KINDS).optional(),
    label: TileLabelSchema.optional(),
    labelPosition: tileStyle.labelPosition.optional(),
    fontSize: tileStyle.fontSize.optional(),
    colorRole: tileStyle.colorRole.optional(),
    colorMode: tileStyle.colorMode.optional(),
    symbol: tileStyle.symbol.optional(),
    folder: GridSizeSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 1, 'nothing to change');
export type PatchTile = z.infer<typeof PatchTileSchema>;

/**
 * Move a tile to a cell, swapping with the tile already there (if any). `toRev` is
 * required when the target board differs from the tile's board.
 */
export const MoveTileSchema = z
  .object({
    tileId: ObjectIdSchema,
    rev: RevSchema,
    toBoardId: ObjectIdSchema,
    toRev: RevSchema.optional(),
    row: rowSchema,
    col: colSchema,
  })
  .strict();
export type MoveTile = z.infer<typeof MoveTileSchema>;

export interface Tile {
  id: string;
  /** Zero-based cell. */
  row: number;
  col: number;
  kind: TileKind;
  /** Board opened by a folder tile; null for words. */
  targetBoardId: string | null;
  label: string;
  labelPosition: LabelPosition;
  fontSize: FontSize;
  /** Fitzgerald Key colour; null = neutral. */
  colorRole: FitzgeraldRole | null;
  colorMode: ColorMode;
  symbol: { set: SymbolSet; ref: string } | null;
}

export interface Board {
  id: string;
  name: string;
  /** null only for the home board. */
  parentId: string | null;
  rows: number;
  cols: number;
  rev: number;
  tiles: Tile[];
}

/** GET /api/boards: the whole tree, so navigation needs no further requests. */
export interface BoardTree {
  homeId: string | null;
  boards: Board[];
}

/** Every board write answers with the boards it changed (full) and the ones it removed. */
export interface BoardChanges {
  boards: Board[];
  removed: string[];
}

/** Structural problems of a template (empty when it can be created as is). */
export function templateProblems(template: Template): string[] {
  const problems: string[] = [];
  let boards = 0;
  let tiles = 0;
  const walk = (board: TemplateBoard, path: string, depth: number) => {
    boards++;
    if (depth > BOARD_LIMITS.maxDepth)
      problems.push(`${path}: deeper than ${BOARD_LIMITS.maxDepth}`);
    const cells = new Set<string>();
    for (const tile of board.tiles) {
      tiles++;
      const where = `${path} › ${tile.label}`;
      if (tile.row >= board.rows || tile.col >= board.cols)
        problems.push(`${where}: outside the grid`);
      const cell = `${tile.row},${tile.col}`;
      if (cells.has(cell)) problems.push(`${where}: cell ${cell} taken twice`);
      cells.add(cell);
      const folder = tile.kind === 'folder';
      if (folder !== (tile.board !== undefined)) problems.push(`${where}: board iff folder`);
      if (tile.symbol?.set === 'own') problems.push(`${where}: templates cannot use own photos`);
      if (tile.board) walk(tile.board, where, depth + 1);
    }
  };
  walk(template.board, template.name, 0);
  if (boards > BOARD_LIMITS.maxBoards || tiles > BOARD_LIMITS.maxTiles) {
    problems.push(`too big: ${boards} boards, ${tiles} tiles`);
  }
  return problems;
}
