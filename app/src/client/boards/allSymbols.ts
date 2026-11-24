import { RESERVED_HOME_CELL, type Board, type Tile } from '@aplikaacja/shared';

/** The folder "Wszystkie symbole": drawn by the app in the home board's first cell. */
export const ALL_SYMBOLS_ID = 'all-symbols';

export const ALL_SYMBOLS_TILE: Tile = {
  id: ALL_SYMBOLS_ID,
  ...RESERVED_HOME_CELL,
  kind: 'folder',
  targetBoardId: null,
  label: 'Wszystkie symbole',
  labelPosition: null,
  fontSize: 'M',
  colorRole: null,
  colorMode: 'border',
  // ARASAAC "piktogramy": a stack of pictograms.
  symbol: { set: 'arasaac', ref: '15018' },
  hidden: false,
  speech: null,
};

/**
 * `board` with the folder in its reserved cell (home board only). A tile still there (a full
 * home board at the row limit, vault migration v10) keeps the cell; `hidden` marks the
 * folder switched off in the settings (edit mode shows it dimmed, communication mode not).
 */
export function withAllSymbols(board: Board, hidden: boolean): Board {
  if (board.parentId !== null) return board;
  const { row, col } = RESERVED_HOME_CELL;
  if (board.tiles.some((t) => t.row === row && t.col === col)) return board;
  return { ...board, tiles: [{ ...ALL_SYMBOLS_TILE, hidden }, ...board.tiles] };
}
