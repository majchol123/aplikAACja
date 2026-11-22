import { BOARD_LIMITS, type Board, type PatchBoard } from '@relaacja/shared';
import { useState } from 'react';
import { Dialog } from './Dialog.tsx';
import { ui } from './ui.ts';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** Name and grid of a board (PLAN §2.2). */
export function BoardDialog({
  board,
  problem,
  onSave,
  onClose,
}: {
  board: Board;
  problem: string | null;
  onSave: (input: Omit<PatchBoard, 'rev'>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(board.name);
  const [rows, setRows] = useState(board.rows);
  const [cols, setCols] = useState(board.cols);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function save(): Promise<void> {
    const input: Omit<PatchBoard, 'rev'> = {};
    if (trimmed && trimmed !== board.name) input.name = trimmed;
    if (rows !== board.rows) input.rows = rows;
    if (cols !== board.cols) input.cols = cols;
    if (Object.keys(input).length === 0) return onClose();
    setBusy(true);
    const ok = await onSave(input);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog title="Tablica: nazwa i siatka" onClose={onClose}>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className={ui.field}>
          Nazwa
          <input
            value={name}
            maxLength={BOARD_LIMITS.nameMax}
            onChange={(e) => setName(e.target.value)}
            className={ui.input}
            required
          />
        </label>
        {board.parentId && (
          <p className="text-sm text-slate-600">
            To także etykieta folderu, który otwiera tę tablicę.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <label className={ui.field}>
            Wiersze
            <select
              className={ui.input}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            >
              {range(BOARD_LIMITS.maxRows).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className={ui.field}>
            Kolumny
            <select
              className={ui.input}
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
            >
              {range(BOARD_LIMITS.maxCols).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-600">
          Kafelki zostają na swoich polach. Siatkę można zmniejszyć tylko wtedy, gdy poza nią nie ma
          kafelków.
        </p>
        {problem && (
          <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-red-800">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className={ui.primary} disabled={busy || !trimmed}>
            {busy ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
