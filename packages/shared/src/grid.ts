/*
 * Board grids follow the screen (PLAN §2.2): with "fit the grid to the screen" a grid wider
 * than tall on a portrait screen, or taller than wide on a landscape one, is drawn
 * transposed. The tile stored at (row, col) appears at (col, row): the top-left corner
 * stays and the first row becomes the first column, so a Fitzgerald layout keeps its order.
 * Tiles keep their stored places; only the drawing changes, so every word has one place
 * per orientation (motor planning).
 */

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

export function gridLayout(
  board: { rows: number; cols: number },
  { fit, portrait }: { fit: boolean; portrait: boolean },
): GridLayout {
  const transposed = fit && (portrait ? board.cols > board.rows : board.rows > board.cols);
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
