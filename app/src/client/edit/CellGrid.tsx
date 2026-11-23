import { cellAt, toScreen, type Board, type Cell, type Tile } from '@aplikaacja/shared';
import type { ReactNode } from 'react';
import { useGridLayout } from '../boards/layout.ts';

/**
 * The cells of a board as small buttons, laid out as the board looks on this screen
 * (grid.ts): where to move a tile, where to add a ready board. `where` names the cell as
 * seen ("Wiersz 1, kolumna 2"); `cell` is its stored place.
 */
export function CellGrid({
  board,
  label,
  describedBy,
  children,
}: {
  board: Board;
  label: string;
  describedBy?: string;
  children: (cell: Cell, where: string, tile: Tile | undefined) => ReactNode;
}) {
  const layout = useGridLayout(board);
  const at = new Map(board.tiles.map((t) => [`${t.row},${t.col}`, t]));
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
    >
      {Array.from({ length: layout.rows * layout.cols }, (_, i) => {
        const cell = cellAt(layout, i);
        const shown = toScreen(layout, cell);
        const where = `Wiersz ${shown.row + 1}, kolumna ${shown.col + 1}`;
        return children(cell, where, at.get(`${cell.row},${cell.col}`));
      })}
    </div>
  );
}

/** Look of one cell button (empty, taken, or the one in question). */
export function cellClass(state: 'here' | 'taken' | 'empty'): string {
  const base =
    'flex h-12 min-w-0 items-center sm:h-14 justify-center overflow-hidden rounded-lg border-2 p-0.5 text-xs leading-tight';
  const look = {
    here: 'border-brand-700 bg-brand-100 font-bold text-brand-900',
    taken: 'border-slate-300 bg-white text-slate-700 hover:border-brand-600',
    empty: 'border-dashed border-slate-300 bg-slate-50 hover:border-brand-600',
  }[state];
  return `${base} ${look}`;
}
