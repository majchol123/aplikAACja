import { isReservedCell, type Board, type Cell } from '@aplikaacja/shared';
import { useId, useMemo, useState } from 'react';
import { ALL_SYMBOLS_ID } from '../boards/allSymbols.ts';
import { boardOptions } from '../boards/BoardNav.tsx';
import { useBoardTree } from '../boards/data.ts';
import { CellGrid, cellClass } from '../edit/CellGrid.tsx';
import { Dialog } from '../edit/Dialog.tsx';
import { ui } from '../edit/ui.ts';

export interface Place {
  board: Board;
  cell: Cell;
}

const isFree = (board: Board, cell: Cell) =>
  cell.row < board.rows &&
  cell.col < board.cols &&
  !isReservedCell(board, cell) &&
  !board.tiles.some((t) => t.row === cell.row && t.col === cell.col);

function firstFree(board: Board): Cell | null {
  for (let i = 0; i < board.rows * board.cols; i++) {
    const cell = { row: Math.floor(i / board.cols), col: i % board.cols };
    if (isFree(board, cell)) return cell;
  }
  return null;
}

/**
 * Where a ready board lands as a new folder (PLAN §2.8): any board, any free cell. The
 * first free cell of the board open in the editor comes preselected.
 */
export function PlacePicker({
  name,
  start,
  busy,
  problem,
  onPlace,
  onClose,
}: {
  name: string;
  start: Board;
  /** Progress text while placing; the choice is locked meanwhile. */
  busy: string | null;
  problem: string | null;
  onPlace: (place: Place) => void;
  onClose: () => void;
}) {
  const id = useId();
  const tree = useBoardTree();
  const boards = useMemo(
    () => new Map((tree.data?.boards ?? [start]).map((b) => [b.id, b])),
    [tree.data, start],
  );
  const homeId = tree.data?.homeId ?? start.id;
  const options = useMemo(() => boardOptions(boards, homeId), [boards, homeId]);
  const [targetId, setTargetId] = useState(start.id);
  const target = boards.get(targetId) ?? start;
  const [picked, setPicked] = useState<{ boardId: string; cell: Cell } | null>(null);
  // A cell taken meanwhile (another device) falls back to the first free one.
  const chosen =
    picked && picked.boardId === target.id && isFree(target, picked.cell)
      ? picked.cell
      : firstFree(target);
  const locked = busy !== null;

  return (
    <Dialog title={`Gdzie dodać „${name}”?`} onClose={onClose} wide>
      <div className="mt-4 space-y-4">
        <label className={ui.field}>
          Tablica
          <select
            className={ui.input}
            value={target.id}
            disabled={locked}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        {chosen ? (
          <>
            <p id={`${id}-hint`} className="text-sm text-slate-600">
              Wybierz puste pole: pojawi się w nim folder „{name}”.
            </p>
            <CellGrid
              board={target}
              label={`Pola tablicy ${target.name}`}
              describedBy={`${id}-hint`}
            >
              {(cell, where, tile) => {
                const selected = cell.row === chosen.row && cell.col === chosen.col;
                return (
                  <button
                    key={`${cell.row},${cell.col}`}
                    type="button"
                    disabled={locked || tile !== undefined}
                    aria-pressed={tile ? undefined : selected}
                    aria-label={
                      tile?.id === ALL_SYMBOLS_ID
                        ? `${where}: ${tile.label} (stałe pole)`
                        : tile
                          ? `${where}: zajęte („${tile.label}”)`
                          : selected
                            ? `${where}: tu będzie „${name}”`
                            : `${where}: puste`
                    }
                    onClick={() => setPicked({ boardId: target.id, cell })}
                    className={cellClass(selected ? 'here' : tile ? 'taken' : 'empty')}
                  >
                    <span className="line-clamp-2 break-all">
                      {selected ? name : (tile?.label ?? '')}
                    </span>
                  </button>
                );
              }}
            </CellGrid>
          </>
        ) : (
          <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
            Na tablicy „{target.name}” nie ma wolnego pola. Wybierz inną tablicę albo powiększ jej
            siatkę („Nazwa i siatka”).
          </p>
        )}
        {problem && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800">
            {problem}
          </p>
        )}
        {busy && (
          <p role="status" className="text-slate-700">
            {busy}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className={ui.primary}
            disabled={!chosen || locked}
            onClick={() => chosen && onPlace({ board: target, cell: chosen })}
          >
            Dodaj tutaj
          </button>
        </div>
      </div>
    </Dialog>
  );
}
