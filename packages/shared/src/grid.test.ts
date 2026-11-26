import { describe, expect, it } from 'vitest';
import { cellAt, gridLayout, toScreen, trimmedBoardGrid } from './grid.ts';

const wide = { rows: 4, cols: 6 };
const tall = { rows: 6, cols: 4 };

describe('grid layout', () => {
  it('trims trailing empty rows and columns in communication mode while keeping tile cells', () => {
    // Trailing empty rows/cols beyond the last occupied cell are trimmed.
    expect(
      trimmedBoardGrid({
        parentId: null,
        rows: 8,
        cols: 6,
        tiles: [
          { row: 0, col: 5 },
          { row: 3, col: 2 },
        ],
      }),
    ).toEqual({ rows: 4, cols: 6 });

    // Hidden tiles are part of `board.tiles`, so their cells stay reserved for motor planning.
    expect(
      trimmedBoardGrid({
        parentId: 'parent',
        rows: 10,
        cols: 8,
        tiles: [{ row: 4, col: 3 }],
      }),
    ).toEqual({ rows: 5, cols: 4 });

    // An empty sub-board keeps its declared grid; an empty home board keeps at least (1, 1) for cell (0, 0).
    expect(
      trimmedBoardGrid({
        parentId: 'parent',
        rows: 4,
        cols: 5,
        tiles: [],
      }),
    ).toEqual({ rows: 4, cols: 5 });
    expect(
      trimmedBoardGrid({
        parentId: null,
        rows: 4,
        cols: 6,
        tiles: [],
      }),
    ).toEqual({ rows: 1, cols: 1 });
  });

  it('turns a grid to the orientation of the screen only when asked', () => {
    expect(gridLayout(wide, { fit: true, portrait: true })).toEqual({
      rows: 6,
      cols: 4,
      transposed: true,
    });
    expect(gridLayout(wide, { fit: true, portrait: false }).transposed).toBe(false);
    expect(gridLayout(wide, { fit: false, portrait: true }).transposed).toBe(false);
    expect(gridLayout(tall, { fit: true, portrait: false })).toEqual({
      rows: 4,
      cols: 6,
      transposed: true,
    });
    expect(gridLayout(tall, { fit: true, portrait: true }).transposed).toBe(false);
    expect(gridLayout({ rows: 5, cols: 5 }, { fit: true, portrait: true }).transposed).toBe(false);
    // Taller than 12 rows: scrolled, never turned into more columns than a grid has.
    expect(gridLayout({ rows: 12, cols: 4 }, { fit: true, portrait: false }).transposed).toBe(true);
    expect(gridLayout({ rows: 13, cols: 4 }, { fit: true, portrait: false }).transposed).toBe(
      false,
    );
    expect(gridLayout({ rows: 40, cols: 12 }, { fit: true, portrait: true }).transposed).toBe(
      false,
    );
  });

  it('keeps the top-left corner and makes the first row the first column', () => {
    const layout = gridLayout(wide, { fit: true, portrait: true });
    const shown = Array.from({ length: 24 }, (_, i) => cellAt(layout, i));
    expect(shown.slice(0, 4)).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
      { row: 3, col: 0 },
    ]);
    expect(shown[4]).toEqual({ row: 0, col: 1 });
    expect(shown[23]).toEqual({ row: 3, col: 5 });
    // Every board cell exactly once.
    expect(new Set(shown.map((c) => `${c.row},${c.col}`)).size).toBe(24);
    expect(toScreen(layout, { row: 1, col: 5 })).toEqual({ row: 5, col: 1 });
  });

  it('draws an untransposed grid row by row', () => {
    const layout = gridLayout(wide, { fit: false, portrait: true });
    expect(cellAt(layout, 7)).toEqual({ row: 1, col: 1 });
    expect(toScreen(layout, { row: 1, col: 5 })).toEqual({ row: 1, col: 5 });
  });
});
