import type { Board, Tile } from '@relaacja/shared';
import { useId, useMemo, useState } from 'react';
import { boardPath } from '../boards/BoardNav.tsx';
import { ui } from './ui.ts';

/** Boards opened from `rootId` (a folder cannot move into itself or below itself). */
function descendants(boards: Map<string, Board>, rootId: string): Set<string> {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const t of boards.get(id)?.tiles ?? []) if (t.targetBoardId) visit(t.targetBoardId);
  };
  visit(rootId);
  return out;
}

/**
 * Moving a tile to any cell of any board, swapping with the tile there. The keyboard and
 * screen-reader way to move tiles, and the only way between boards (PLAN §2.2).
 */
export function MovePanel({
  boards,
  homeId,
  from,
  tile,
  busy,
  onMove,
  onBack,
}: {
  boards: Map<string, Board>;
  homeId: string;
  from: Board;
  tile: Tile;
  busy: boolean;
  onMove: (toBoardId: string, row: number, col: number) => void;
  onBack: () => void;
}) {
  const id = useId();
  const [targetId, setTargetId] = useState(from.id);
  const options = useMemo(() => {
    const blocked = tile.targetBoardId ? descendants(boards, tile.targetBoardId) : new Set();
    const list: { id: string; name: string }[] = [];
    const walk = (boardId: string) => {
      const board = boards.get(boardId);
      if (!board || blocked.has(boardId)) return;
      list.push({
        id: board.id,
        name: boardPath(boards, board)
          .map((b) => b.name)
          .join(' › '),
      });
      for (const t of [...board.tiles].sort((a, b) => a.row - b.row || a.col - b.col)) {
        if (t.targetBoardId) walk(t.targetBoardId);
      }
    };
    walk(homeId);
    return list;
  }, [boards, homeId, tile.targetBoardId]);
  const target = boards.get(targetId) ?? from;
  const at = new Map(target.tiles.map((t) => [`${t.row},${t.col}`, t]));

  return (
    <div className="mt-4 space-y-4">
      <label className={ui.field}>
        Tablica
        <select
          className={ui.input}
          value={target.id}
          onChange={(e) => setTargetId(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <p id={`${id}-hint`} className="text-sm text-slate-600">
        Wybierz pole. Jeśli jest zajęte, kafelki zamienią się miejscami.
      </p>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${target.cols}, minmax(0, 1fr))` }}
        role="group"
        aria-label={`Pola tablicy ${target.name}`}
        aria-describedby={`${id}-hint`}
      >
        {Array.from({ length: target.rows * target.cols }, (_, i) => {
          const row = Math.floor(i / target.cols);
          const col = i % target.cols;
          const other = at.get(`${row},${col}`);
          const here = other?.id === tile.id;
          const where = `Wiersz ${row + 1}, kolumna ${col + 1}`;
          return (
            <button
              key={i}
              type="button"
              disabled={busy || here}
              aria-label={
                here
                  ? `${where}: tu jest teraz`
                  : other
                    ? `${where}: zamień z „${other.label}”`
                    : `${where}: puste`
              }
              onClick={() => onMove(target.id, row, col)}
              className={`flex h-12 min-w-0 items-center sm:h-14 justify-center overflow-hidden rounded-lg border-2 p-0.5 text-xs leading-tight ${
                here
                  ? 'border-brand-700 bg-brand-100 font-bold text-brand-900'
                  : other
                    ? 'border-slate-300 bg-white text-slate-700 hover:border-brand-600'
                    : 'border-dashed border-slate-300 bg-slate-50 hover:border-brand-600'
              }`}
            >
              <span className="line-clamp-2 break-all">
                {here ? tile.label : (other?.label ?? '')}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className={ui.secondary} onClick={onBack}>
        Wróć
      </button>
    </div>
  );
}
