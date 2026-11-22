import {
  BOARD_LIMITS,
  COLOR_MODES,
  FITZGERALD_ROLES,
  FONT_SIZES,
  LABEL_POSITIONS,
  type Board,
  type BoardChanges,
  type ColorMode,
  type FitzgeraldRole,
  type FontSize,
  type LabelPosition,
  type Me,
  type SymbolHit,
  type SymbolRef,
  type Tile,
  type TileKind,
} from '@relaacja/shared';
import { useId, useState, type ReactNode } from 'react';
import { ROLE_COLORS } from '../boards/colors.ts';
import { useSetPreferred } from '../boards/preferred.ts';
import type { BoardWrite } from '../boards/writes.ts';
import { TileView } from '../comm/TileView.tsx';
import { Dialog } from './Dialog.tsx';
import { MovePanel } from './MovePanel.tsx';
import { hitSymbol, SymbolPicker } from './SymbolPicker.tsx';
import { ui } from './ui.ts';

export const ROLE_NAMES: Record<FitzgeraldRole, string> = {
  person: 'Osoby',
  noun: 'Rzeczowniki',
  verb: 'Czynności',
  descriptor: 'Określenia',
  social: 'Zwroty społeczne',
  question: 'Pytania',
  negation: 'Przeczenia',
  misc: 'Inne',
};
const POSITION_NAMES: Record<LabelPosition, string> = {
  top: 'Nad obrazkiem',
  bottom: 'Pod obrazkiem',
};
const MODE_NAMES: Record<ColorMode, string> = { border: 'Ramka', background: 'Tło' };

interface Draft {
  label: string;
  kind: TileKind;
  labelPosition: LabelPosition;
  fontSize: FontSize;
  colorRole: FitzgeraldRole | null;
  colorMode: ColorMode;
  symbol: SymbolRef | null;
}

const BOARDS_PL = ['tablica', 'tablice', 'tablic'] as const;
const TILES_PL = ['kafelek', 'kafelki', 'kafelków'] as const;

/** "1 tablica", "3 tablice", "5 tablic", "22 tablice". */
export function countPl(n: number, [one, few, many]: readonly [string, string, string]): string {
  const tens = n % 100;
  const units = n % 10;
  const word = n === 1 ? one : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
  return `${n} ${word}`;
}

const sameSymbol = (a: SymbolRef | null, b: SymbolRef | null) =>
  a === b || (a !== null && b !== null && a.set === b.set && a.ref === b.ref);

/** Boards and tiles that disappear together with a folder's board. */
export function subtreeSize(boards: Map<string, Board>, boardId: string) {
  let count = 0;
  let tiles = 0;
  const visit = (id: string) => {
    const board = boards.get(id);
    if (!board || count > BOARD_LIMITS.maxBoards) return;
    count++;
    tiles += board.tiles.length;
    for (const t of board.tiles) if (t.targetBoardId) visit(t.targetBoardId);
  };
  visit(boardId);
  return { boards: count, tiles };
}

function Choices<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  render,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (value: T) => ReactNode;
}) {
  return (
    <fieldset>
      <legend className={ui.field}>{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className={ui.choice}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {render(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Adds a tile to an empty cell or edits one (PLAN §2.2). */
export function TileEditor({
  me,
  boards,
  homeId,
  board,
  cell,
  tile,
  resolve,
  uppercase,
  write,
  problem,
  onClose,
  onOpenFolder,
}: {
  me: Me;
  boards: Map<string, Board>;
  homeId: string;
  board: Board;
  cell: { row: number; col: number };
  tile: Tile | undefined;
  resolve: (symbol: Tile['symbol']) => string | null;
  uppercase: boolean;
  write: (change: BoardWrite) => Promise<BoardChanges | null>;
  problem: string | null;
  onClose: () => void;
  onOpenFolder: (boardId: string) => void;
}) {
  const id = useId();
  const setPreferred = useSetPreferred();
  const [draft, setDraft] = useState<Draft>(() => ({
    label: tile?.label ?? '',
    kind: tile?.kind ?? 'word',
    labelPosition: tile?.labelPosition ?? 'bottom',
    fontSize: tile?.fontSize ?? 'M',
    colorRole: tile?.colorRole ?? null,
    colorMode: tile?.colorMode ?? 'border',
    symbol: tile?.symbol ?? null,
  }));
  // Picking a symbol proposes its part-of-speech colour until a colour is chosen by hand.
  const [autoColor, setAutoColor] = useState(true);
  // null: the search follows the label.
  const [query, setQuery] = useState<string | null>(null);
  // Keyword of the symbol picked from the search: becomes the word's preferred variant.
  const [picked, setPicked] = useState<{ word: string; symbol: SymbolRef } | null>(null);
  const [step, setStep] = useState<'edit' | 'move' | 'confirm-delete' | 'confirm-word'>('edit');
  const [busy, setBusy] = useState(false);
  const [missingLabel, setMissingLabel] = useState(false);

  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const pick = (hit: SymbolHit) => {
    const symbol = hitSymbol(hit);
    setPicked({ word: hit.label, symbol });
    setDraft((d) => ({
      ...d,
      symbol,
      label: d.label.trim() ? d.label : hit.label,
      colorRole: autoColor ? hit.role : d.colorRole,
    }));
  };

  const folderBoard = tile?.targetBoardId ? boards.get(tile.targetBoardId) : undefined;
  const lost = folderBoard ? subtreeSize(boards, folderBoard.id) : null;

  async function run(change: BoardWrite): Promise<boolean> {
    setBusy(true);
    const result = await write(change);
    setBusy(false);
    return result !== null;
  }

  async function save(confirmed = false): Promise<void> {
    const label = draft.label.trim();
    if (!label) {
      setMissingLabel(true);
      return;
    }
    let ok: boolean;
    if (tile) {
      const input: Partial<Omit<Draft, 'symbol'>> & { symbol?: SymbolRef | null } = {};
      if (label !== tile.label) input.label = label;
      if (draft.kind !== tile.kind) input.kind = draft.kind;
      if (draft.labelPosition !== tile.labelPosition) input.labelPosition = draft.labelPosition;
      if (draft.fontSize !== tile.fontSize) input.fontSize = draft.fontSize;
      if (draft.colorRole !== tile.colorRole) input.colorRole = draft.colorRole;
      if (draft.colorMode !== tile.colorMode) input.colorMode = draft.colorMode;
      if (!sameSymbol(draft.symbol, tile.symbol)) input.symbol = draft.symbol;
      if (Object.keys(input).length === 0) return onClose();
      if (input.kind === 'word' && lost && !confirmed) {
        setStep('confirm-word');
        return;
      }
      ok = await run({ op: 'patchTile', boardId: board.id, tileId: tile.id, input });
    } else {
      ok = await run({
        op: 'createTile',
        boardId: board.id,
        input: { ...cell, ...draft, label },
      });
    }
    if (!ok) {
      setStep('edit');
      return;
    }
    if (picked && draft.symbol && sameSymbol(picked.symbol, draft.symbol)) {
      setPreferred.mutate({ word: picked.word, symbol: picked.symbol });
    }
    onClose();
  }

  async function remove(): Promise<void> {
    if (!tile) return;
    if (await run({ op: 'deleteTile', boardId: board.id, tileId: tile.id })) onClose();
    else setStep('edit');
  }

  const title = tile ? `Kafelek „${tile.label}”` : 'Nowy kafelek';
  const errorBox = problem && (
    <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">
      {problem}
    </p>
  );

  if (step === 'move' && tile) {
    return (
      <Dialog title={`Przenieś „${tile.label}”`} onClose={onClose} wide>
        <MovePanel
          boards={boards}
          homeId={homeId}
          from={board}
          tile={tile}
          busy={busy}
          onBack={() => setStep('edit')}
          onMove={async (toBoardId, row, col) => {
            const ok = await run({
              op: 'moveTile',
              boardId: board.id,
              tileId: tile.id,
              toBoardId,
              row,
              col,
            });
            if (ok) onClose();
          }}
        />
        {errorBox}
      </Dialog>
    );
  }

  if ((step === 'confirm-delete' || step === 'confirm-word') && tile) {
    const deleting = step === 'confirm-delete';
    return (
      <Dialog
        title={deleting ? `Usunąć „${tile.label}”?` : 'Zmienić folder w słowo?'}
        onClose={onClose}
      >
        <p className="mt-3 text-slate-700">
          {lost
            ? `Razem z folderem zniknie jego zawartość: ${countPl(lost.boards, BOARDS_PL)} i ${countPl(lost.tiles, TILES_PL)}. Tego nie da się cofnąć.`
            : 'Tego nie da się cofnąć.'}
        </p>
        {errorBox}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={() => setStep('edit')}>
            Wróć
          </button>
          <button
            type="button"
            className={ui.danger}
            disabled={busy}
            onClick={() => void (deleting ? remove() : save(true))}
          >
            {deleting ? 'Usuń' : 'Zmień w słowo'}
          </button>
        </div>
      </Dialog>
    );
  }

  const preview: Tile = {
    id: tile?.id ?? 'preview',
    row: cell.row,
    col: cell.col,
    targetBoardId: tile?.targetBoardId ?? null,
    ...draft,
    label: draft.label.trim() || '…',
  };

  return (
    <Dialog title={title} onClose={onClose} wide>
      <form
        className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="space-y-5">
          <div className="flex items-end gap-4">
            <div className="tile-cell size-32 shrink-0" aria-hidden="true">
              <TileView tile={preview} src={resolve(draft.symbol)} uppercase={uppercase} />
            </div>
            <label className={`${ui.field} flex-1`}>
              Etykieta
              <input
                value={draft.label}
                maxLength={BOARD_LIMITS.labelMax}
                onChange={(e) => {
                  setMissingLabel(false);
                  change({ label: e.target.value });
                }}
                aria-invalid={missingLabel}
                aria-describedby={missingLabel ? `${id}-label-error` : undefined}
                className={ui.input}
                autoComplete="off"
              />
              {missingLabel && (
                <span id={`${id}-label-error`} className="mt-1 block text-red-700">
                  Wpisz etykietę.
                </span>
              )}
            </label>
          </div>

          <Choices
            legend="Rodzaj"
            name={`${id}-kind`}
            options={['word', 'folder'] as const}
            value={draft.kind}
            onChange={(kind) => change({ kind })}
            render={(k) => (k === 'word' ? 'Słowo' : 'Folder (otwiera tablicę)')}
          />
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-slate-600">
                {draft.symbol
                  ? 'Obrazek wybrany — widać go na podglądzie kafelka.'
                  : 'Bez obrazka — sam napis.'}
              </span>
              {draft.symbol && (
                <button
                  type="button"
                  className="text-sm text-brand-800 underline underline-offset-4"
                  onClick={() => {
                    setPicked(null);
                    change({ symbol: null });
                  }}
                >
                  Usuń obrazek
                </button>
              )}
            </div>
            <SymbolPicker
              me={me}
              query={query ?? draft.label}
              onQuery={setQuery}
              selected={draft.symbol}
              onPick={pick}
            />
          </div>
        </div>
        <div className="space-y-5">
          <h3 className="text-base font-bold text-slate-800">Wygląd</h3>
          <Choices
            legend="Położenie etykiety"
            name={`${id}-position`}
            options={LABEL_POSITIONS}
            value={draft.labelPosition}
            onChange={(labelPosition) => change({ labelPosition })}
            render={(p) => POSITION_NAMES[p]}
          />
          <Choices
            legend="Rozmiar napisu"
            name={`${id}-size`}
            options={FONT_SIZES}
            value={draft.fontSize}
            onChange={(fontSize) => change({ fontSize })}
            render={(s) => s}
          />
          <fieldset>
            <legend className={ui.field}>Kolor (klucz Fitzgeralda)</legend>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">
              {[...FITZGERALD_ROLES, null].map((role) => (
                <label key={role ?? 'none'} className={`${ui.choice} justify-start gap-2`}>
                  <input
                    type="radio"
                    name={`${id}-color`}
                    checked={draft.colorRole === role}
                    onChange={() => {
                      setAutoColor(false);
                      change({ colorRole: role });
                    }}
                    className="sr-only"
                  />
                  <span
                    className={`size-5 shrink-0 rounded-md border-4 ${ROLE_COLORS[role ?? 'none'].border} ${ROLE_COLORS[role ?? 'none'].background}`}
                    aria-hidden="true"
                  />
                  {role ? ROLE_NAMES[role] : 'Bez koloru'}
                </label>
              ))}
            </div>
          </fieldset>
          <Choices
            legend="Kolor jako"
            name={`${id}-mode`}
            options={COLOR_MODES}
            value={draft.colorMode}
            onChange={(colorMode) => change({ colorMode })}
            render={(m) => MODE_NAMES[m]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          {tile && (
            <>
              <button type="button" className={ui.danger} onClick={() => setStep('confirm-delete')}>
                Usuń
              </button>
              <button type="button" className={ui.secondary} onClick={() => setStep('move')}>
                Przenieś…
              </button>
              {folderBoard && (
                <button
                  type="button"
                  className={ui.secondary}
                  onClick={() => {
                    onClose();
                    onOpenFolder(folderBoard.id);
                  }}
                >
                  Otwórz folder
                </button>
              )}
            </>
          )}
          <span className="flex-1" />
          <button type="button" className={ui.secondary} onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className={ui.primary} disabled={busy}>
            {busy ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </form>
      {errorBox}
    </Dialog>
  );
}
