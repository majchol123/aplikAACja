import type { Board, Tile } from '@aplikaacja/shared';
import { useId, useMemo, useState } from 'react';
import { boardOptions } from '../boards/BoardNav.tsx';
import { CellGrid, cellClass } from './CellGrid.tsx';
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
  const options = useMemo(
    () =>
      boardOptions(
        boards,
        homeId,
        tile.targetBoardId ? descendants(boards, tile.targetBoardId) : undefined,
      ),
    [boards, homeId, tile.targetBoardId],
  );
  const target = boards.get(targetId) ?? from;

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
      <CellGrid board={target} label={`Pola tablicy ${target.name}`} describedBy={`${id}-hint`}>
        {({ row, col }, where, other) => {
          const here = other?.id === tile.id;
          return (
            <button
              key={`${row},${col}`}
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
              className={cellClass(here ? 'here' : other ? 'taken' : 'empty')}
            >
              <span className="line-clamp-2 break-all">
                {here ? tile.label : (other?.label ?? '')}
              </span>
            </button>
          );
        }}
      </CellGrid>
      <button type="button" className={ui.secondary} onClick={onBack}>
        Wróć
      </button>
    </div>
  );
}
