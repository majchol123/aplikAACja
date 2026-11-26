/*
 * Board grids follow the screen (PLAN §2.2): with "fit the grid to the screen" a grid wider
 * than tall on a portrait screen, or taller than wide on a landscape one, is drawn
 * transposed. The tile stored at (row, col) appears at (col, row): the top-left corner
 * stays and the first row becomes the first column, so a Fitzgerald layout keeps its order.
 * Tiles keep their stored places; only the drawing changes, so every word has one place
 * per orientation (motor planning).
 */

import { BOARD_LIMITS } from './boards.ts';

export interface Cell {
  row: number;
  col: number;
}

export interface GridLayout {
  /** Rows and columns on screen. */
  rows: number;
  cols: number;
  transposed: boolean;
}

/**
 * Effective `(rows, cols)` of a board in communication mode: trailing completely empty rows
 * and columns beyond the last tile (hidden tiles still hold their cells for motor planning,
 * and the home board's reserved first cell `(0, 0)` always counts) are trimmed so accidental
 * extra grid rows or columns from the editor never shrink tiles or add blank scrollbars.
 */
export function trimmedBoardGrid(board: {
  parentId: string | null;
  rows: number;
  cols: number;
  tiles: readonly { row: number; col: number }[];
}): { rows: number; cols: number } {
  let maxRow = board.parentId === null ? 0 : -1;
  let maxCol = board.parentId === null ? 0 : -1;
  for (const tile of board.tiles) {
    if (tile.row > maxRow) maxRow = tile.row;
    if (tile.col > maxCol) maxCol = tile.col;
  }
  if (maxRow < 0) return { rows: board.rows, cols: board.cols };
  return {
    rows: Math.min(board.rows, maxRow + 1),
    cols: Math.min(board.cols, maxCol + 1),
  };
}

export function gridLayout(
  board: { rows: number; cols: number },
  { fit, portrait }: { fit: boolean; portrait: boolean },
): GridLayout {
  // A board taller than the widest grid (it scrolls down) stays upright: turned, it would
  // need more columns than a screen takes.
  const transposed =
    fit &&
    (portrait
      ? board.cols > board.rows
      : board.rows > board.cols && board.rows <= BOARD_LIMITS.maxCols);
  return transposed
    ? { rows: board.cols, cols: board.rows, transposed }
    : { rows: board.rows, cols: board.cols, transposed };
}

/** The board cell drawn at screen position `i` (screen cells counted row by row). */
export function cellAt(layout: GridLayout, i: number): Cell {
  return toScreen(layout, { row: Math.floor(i / layout.cols), col: i % layout.cols });
}

/** Where a board cell is on screen, and back: transposing twice is the identity. */
export function toScreen(layout: GridLayout, cell: Cell): Cell {
  return layout.transposed ? { row: cell.col, col: cell.row } : cell;
}
