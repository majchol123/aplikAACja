import type { GridSize } from './boards.ts';

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPaging = 'auto' | 'single';

export interface PrintPageSlice {
  page: number;
  totalPages: number;
  rowStart: number;
  rowCount: number;
  /** Row track count of the page grid (constant across pages so tiles keep the same size). */
  gridRows: number;
}

/** Printable area of A4 with 10 mm margins and room for the board title and attribution. */
const PAGE_USABLE_MM: Record<PrintOrientation, { width: number; height: number }> = {
  portrait: { width: 190, height: 261 },
  landscape: { width: 277, height: 174 },
};
const GAP_MM = 3;
/** Typical tile height-to-width ratio (square picture + label). */
const TILE_ASPECT = 1.22;

/** Maximum rows per page in automatic pagination so printed tiles stay legible. */
export const MAX_PRINT_ROWS: Record<PrintOrientation, number> = {
  portrait: 6,
  landscape: 4,
};

/** Splits `totalRows` into balanced pages so every page has tiles of the same physical size. */
export function boardPrintPages(
  totalRows: number,
  orientation: PrintOrientation,
  paging: PrintPaging = 'auto',
): PrintPageSlice[] {
  if (totalRows <= 0) return [];
  const maxRows = paging === 'single' ? totalRows : MAX_PRINT_ROWS[orientation];
  const totalPages = Math.max(1, Math.ceil(totalRows / maxRows));
  const gridRows = Math.ceil(totalRows / totalPages);
  const slices: PrintPageSlice[] = [];
  for (let page = 0; page < totalPages; page++) {
    const rowStart = page * gridRows;
    const rowCount = Math.min(gridRows, totalRows - rowStart);
    if (rowCount > 0) slices.push({ page, totalPages, rowStart, rowCount, gridRows });
  }
  return slices;
}

/** Page count and estimated symbol size (mm) for a grid printed in `orientation`. */
export function printSymbolScore(
  grid: GridSize,
  orientation: PrintOrientation,
  paging: PrintPaging = 'auto',
): { pages: number; symbolMm: number } {
  const pages = boardPrintPages(grid.rows, orientation, paging);
  const rowsOnPage = pages[0]?.gridRows ?? grid.rows;
  const box = PAGE_USABLE_MM[orientation];
  const cellW = (box.width - (grid.cols - 1) * GAP_MM) / grid.cols;
  const cellH = (box.height - (rowsOnPage - 1) * GAP_MM) / rowsOnPage;
  return { pages: pages.length, symbolMm: Math.min(cellW, cellH / TILE_ASPECT) };
}

/**
 * Picks the page orientation for a board grid: avoids splitting a single-page board across
 * pages when it fits on one page in the other orientation, and otherwise maximises symbol size.
 * Uses canonical `(rows, cols)`, never the screen's `fitGrid` transposition.
 */
export function autoPrintOrientation(
  grid: GridSize,
  paging: PrintPaging = 'auto',
): PrintOrientation {
  const p = printSymbolScore(grid, 'portrait', paging);
  const l = printSymbolScore(grid, 'landscape', paging);
  if ((p.pages === 1) !== (l.pages === 1)) {
    return p.pages === 1 ? 'portrait' : 'landscape';
  }
  if (Math.abs(l.symbolMm - p.symbolMm) > 0.2) {
    return l.symbolMm > p.symbolMm ? 'landscape' : 'portrait';
  }
  return grid.cols > grid.rows ? 'landscape' : 'portrait';
}
