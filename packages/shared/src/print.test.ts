import { describe, expect, it } from 'vitest';
import { autoPrintOrientation, boardPrintPages, printSymbolScore } from './print.ts';

describe('board printing layout', () => {
  it('picks orientation to fit one page first and then maximise symbol size', () => {
    expect(autoPrintOrientation({ rows: 4, cols: 6 })).toBe('landscape');
    expect(autoPrintOrientation({ rows: 6, cols: 4 })).toBe('portrait');
    expect(autoPrintOrientation({ rows: 4, cols: 4 })).toBe('portrait');
    expect(autoPrintOrientation({ rows: 3, cols: 4 })).toBe('landscape');
    expect(autoPrintOrientation({ rows: 4, cols: 5 })).toBe('portrait');
    expect(autoPrintOrientation({ rows: 8, cols: 3 })).toBe('portrait');
    expect(autoPrintOrientation({ rows: 8, cols: 6 })).toBe('landscape');
    expect(autoPrintOrientation({ rows: 10, cols: 8 })).toBe('landscape');
    expect(autoPrintOrientation({ rows: 4, cols: 12 })).toBe('landscape');
  });

  it('chooses purely by symbol size in single-page mode', () => {
    expect(autoPrintOrientation({ rows: 6, cols: 4 }, 'single')).toBe('portrait');
    expect(autoPrintOrientation({ rows: 4, cols: 6 }, 'single')).toBe('landscape');
    expect(autoPrintOrientation({ rows: 10, cols: 3 }, 'single')).toBe('portrait');
    expect(autoPrintOrientation({ rows: 4, cols: 10 }, 'single')).toBe('landscape');
  });

  it('splits tall boards into balanced pages with uniform gridRows', () => {
    expect(boardPrintPages(6, 'portrait', 'auto')).toEqual([
      { page: 0, totalPages: 1, rowStart: 0, rowCount: 6, gridRows: 6 },
    ]);
    expect(boardPrintPages(7, 'portrait', 'auto')).toEqual([
      { page: 0, totalPages: 2, rowStart: 0, rowCount: 4, gridRows: 4 },
      { page: 1, totalPages: 2, rowStart: 4, rowCount: 3, gridRows: 4 },
    ]);
    expect(boardPrintPages(9, 'landscape', 'auto')).toEqual([
      { page: 0, totalPages: 3, rowStart: 0, rowCount: 3, gridRows: 3 },
      { page: 1, totalPages: 3, rowStart: 3, rowCount: 3, gridRows: 3 },
      { page: 2, totalPages: 3, rowStart: 6, rowCount: 3, gridRows: 3 },
    ]);
    expect(boardPrintPages(12, 'landscape', 'single')).toEqual([
      { page: 0, totalPages: 1, rowStart: 0, rowCount: 12, gridRows: 12 },
    ]);
    expect(printSymbolScore({ rows: 4, cols: 4 }, 'portrait').symbolMm).toBeGreaterThan(
      printSymbolScore({ rows: 4, cols: 4 }, 'landscape').symbolMm,
    );
  });
});
