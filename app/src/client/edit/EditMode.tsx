import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react';
import type { ComponentProps } from 'react';
import { Accessibility, Feedback, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';
import {
  cellAt,
  toScreen,
  type Board,
  type BoardTree,
  type Me,
  type Tile,
} from '@aplikaacja/shared';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BoardNav } from '../boards/BoardNav.tsx';
import { useSymbolResolver } from '../boards/data.ts';
import { useGridLayout } from '../boards/layout.ts';
import { useBoardWrites } from '../boards/writes.ts';
import {
  GearIcon,
  GridIcon,
  KeyboardIcon,
  OpenIcon,
  PlusIcon,
  SearchIcon,
} from '../comm/icons.tsx';
import { TileView } from '../comm/TileView.tsx';
import { useAccountSettings } from '../settings/account.ts';
import { PolicyNotice } from '../settings/PolicyNotice.tsx';
import { SearchPanel } from '../comm/SearchPanel.tsx';
import { PhraseGenerator } from '../phrase/PhraseGenerator.tsx';
import { AddBoardDialog } from '../shares/AddBoardDialog.tsx';
import { ShareDialog } from '../shares/ShareDialog.tsx';
import { useShares } from '../shares/data.ts';
import { BoardDialog } from './BoardDialog.tsx';
import { TileEditor } from './TileEditor.tsx';

/**
 * Pointer dragging only: a long press (touch) or a short move (mouse) starts it, so a tap
 * still opens the tile. Keyboard users move tiles from the tile dialog ("Przenieś…").
 */
const SENSORS = () => [
  PointerSensor.configure({
    activationConstraints(event) {
      return event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 300, tolerance: 8 })]
        : [new PointerActivationConstraints.Distance({ value: 6 })];
    },
  }),
];
type PluginsFn = Extract<
  NonNullable<ComponentProps<typeof DragDropProvider>['plugins']>,
  (...args: never[]) => unknown
>;
type AccessibilityOptions = NonNullable<ConstructorParameters<typeof Accessibility>[1]>;
const FEEDBACK = [Feedback.configure({ dropAnimation: null })];
const cellId = (row: number, col: number) => `cell-${row}-${col}`;
const CELL_ID = /^cell-(\d+)-(\d+)$/;

/** "wiersz 2, kolumna 3" as on screen (the grid may be transposed, grid.ts), set on each cell. */
function cellName(target: { element?: Element | null } | null): string {
  return (target?.element as HTMLElement | null | undefined)?.dataset.where ?? '';
}

/** The dragged tile's label, read from the element (announcements run outside React). */
function labelOf(source: { element?: Element | null } | null): string {
  return `„${source?.element?.querySelector('.tile-label')?.textContent ?? ''}”`;
}

/** Polish screen-reader texts (the library ships English ones and keyboard instructions). */
const ACCESSIBILITY_OPTIONS: AccessibilityOptions = {
  screenReaderInstructions: {
    draggable:
      'Dotknij lub naciśnij Enter, aby zmienić kafelek. Przytrzymaj i przeciągnij, aby go przenieść; z klawiatury przeniesiesz go przyciskiem „Przenieś…” w oknie kafelka.',
  },
  announcements: {
    dragstart: ({ operation: { source } }) =>
      source ? `Przenoszenie kafelka ${labelOf(source)}.` : undefined,
    dragover: ({ operation: { source, target } }) =>
      source && target ? `${labelOf(source)} nad polem: ${cellName(target)}.` : undefined,
    dragend: ({ operation: { source, target }, canceled }) => {
      if (!source) return undefined;
      if (canceled || !target) return 'Przenoszenie anulowane.';
      return `Upuszczono ${labelOf(source)} na polu: ${cellName(target)}.`;
    },
  },
};
const PLUGINS = (defaults: Parameters<PluginsFn>[0]) => [
  ...defaults,
  Accessibility.configure(ACCESSIBILITY_OPTIONS),
];

type Editing = { row: number; col: number; tileId: string | null };

/** Edit mode (PLAN §2.2): the same grid, every cell editable, tiles draggable. */
export function EditMode({
  me,
  tree,
  boardId,
  onBoardChange,
  onSettings,
  onDone,
}: {
  me: Me;
  tree: BoardTree;
  boardId: string | null;
  onBoardChange: (boardId: string) => void;
  onSettings: () => void;
  onDone: () => void;
}) {
  const boards = useMemo(() => new Map(tree.boards.map((b) => [b.id, b])), [tree.boards]);
  const homeId = tree.homeId ?? '';
  const board = boards.get(boardId ?? homeId) ?? boards.get(homeId);
  const allTiles = useMemo(() => tree.boards.flatMap((b) => b.tiles), [tree.boards]);
  const resolve = useSymbolResolver(me, allTiles);
  const account = useAccountSettings();
  const uppercase = account.data?.uppercaseLabels ?? false;
  const writes = useBoardWrites();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [boardDialog, setBoardDialog] = useState(false);
  const [sharing, setSharing] = useState<'share' | 'inbox' | null>(null);
  const [searching, setSearching] = useState(false);
  const [phrasing, setPhrasing] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  // The ring of a tile found with the search fades after a few seconds.
  useEffect(() => {
    if (!found) return;
    const timer = window.setTimeout(() => setFound(null), 4000);
    return () => window.clearTimeout(timer);
  }, [found]);
  const shares = useShares();
  const received = shares.data?.received.length ?? 0;

  if (!board) return null;
  const editedTile = editing?.tileId ? board.tiles.find((t) => t.id === editing.tileId) : undefined;
  const open = (next: Editing) => {
    writes.dismiss();
    setEditing(next);
  };

  return (
    <main className="edit-root flex h-dvh flex-col gap-2 bg-amber-50 p-2 sm:gap-3 sm:p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="rounded-full bg-amber-200 px-4 py-2 text-lg font-bold text-amber-950">
          Tryb edycji
        </h1>
        <span className="text-sm text-slate-600" role="status" aria-live="polite">
          {writes.saving ? 'Zapisywanie…' : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            writes.dismiss();
            setBoardDialog(true);
          }}
          className="flex items-center gap-2 rounded-full border border-brand-700 bg-white px-4 py-2 font-semibold text-brand-800 hover:bg-brand-50"
        >
          <GridIcon /> Nazwa i siatka
        </button>
        <button
          type="button"
          onClick={() => {
            writes.dismiss();
            setSharing('share');
          }}
          className="rounded-full border border-brand-700 bg-white px-4 py-2 font-semibold text-brand-800 hover:bg-brand-50"
        >
          Udostępnij
        </button>
        <button
          type="button"
          onClick={() => {
            writes.dismiss();
            setSharing('inbox');
          }}
          className={
            received > 0
              ? 'rounded-full bg-amber-300 px-4 py-2 font-semibold text-amber-950 ring-1 ring-amber-500 hover:bg-amber-200'
              : 'rounded-full border border-brand-700 bg-white px-4 py-2 font-semibold text-brand-800 hover:bg-brand-50'
          }
        >
          {received > 0 ? `Dodaj tablicę (otrzymane: ${received})` : 'Dodaj tablicę'}
        </button>
        <button
          type="button"
          onClick={onSettings}
          className="flex items-center gap-2 rounded-full border border-brand-700 bg-white px-4 py-2 font-semibold text-brand-800 hover:bg-brand-50"
        >
          <GearIcon /> Ustawienia
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-brand-700 px-5 py-2 font-semibold text-white hover:bg-brand-800"
        >
          Gotowe
        </button>
      </header>
      {writes.problem && !editing && !boardDialog && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl bg-red-50 px-4 py-2 text-red-800"
        >
          <span className="flex-1">{writes.problem}</span>
          <button type="button" className="font-semibold underline" onClick={writes.dismiss}>
            Zamknij
          </button>
        </div>
      )}
      <PolicyNotice />
      <BoardNav boards={boards} board={board} homeId={homeId} onOpen={onBoardChange}>
        <button
          type="button"
          aria-label="Szukaj kafelka"
          onClick={() => setSearching(true)}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          aria-label="Generator fraz"
          title="Generator fraz: zdanie w symbolach"
          onClick={() => {
            writes.dismiss();
            setPhrasing(true);
          }}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
        >
          <KeyboardIcon />
        </button>
      </BoardNav>
      {phrasing && <PhraseGenerator me={me} board={board} onClose={() => setPhrasing(false)} />}
      {searching && (
        <SearchPanel
          me={me}
          tree={tree}
          sources="tiles"
          includeHidden
          resolve={resolve}
          onShowTile={(tile, on) => {
            setSearching(false);
            onBoardChange(on.id);
            setFound(tile.id);
          }}
          onPick={() => setSearching(false)}
          onClose={() => setSearching(false)}
        />
      )}
      <p className="text-sm text-slate-700 short:hidden">
        Dotknij kafelka, aby go zmienić, albo pustego pola, aby dodać nowy. Przytrzymaj kafelek i
        przeciągnij, aby go przenieść.
      </p>
      <EditGrid
        board={board}
        resolve={resolve}
        uppercase={uppercase}
        found={found}
        onEdit={(tile) => open({ row: tile.row, col: tile.col, tileId: tile.id })}
        onAdd={(row, col) => open({ row, col, tileId: null })}
        onOpen={onBoardChange}
        onMove={(tile, row, col) =>
          void writes.write({
            op: 'moveTile',
            boardId: board.id,
            tileId: tile.id,
            toBoardId: board.id,
            row,
            col,
          })
        }
      />
      {editing && (editing.tileId === null || editedTile) && (
        <TileEditor
          me={me}
          boards={boards}
          homeId={homeId}
          board={board}
          cell={{ row: editing.row, col: editing.col }}
          tile={editedTile}
          resolve={resolve}
          uppercase={uppercase}
          write={writes.write}
          problem={writes.problem}
          onClose={() => setEditing(null)}
          onOpenFolder={onBoardChange}
        />
      )}
      {sharing === 'share' && (
        <ShareDialog
          me={me}
          tree={tree}
          board={board}
          resolve={resolve}
          onClose={() => setSharing(null)}
        />
      )}
      {sharing === 'inbox' && (
        <AddBoardDialog me={me} board={board} onClose={() => setSharing(null)} />
      )}
      {boardDialog && (
        <BoardDialog
          board={board}
          problem={writes.problem}
          onClose={() => setBoardDialog(false)}
          onSave={async (input) =>
            (await writes.write({ op: 'patchBoard', boardId: board.id, input })) !== null
          }
        />
      )}
    </main>
  );
}

function EditGrid({
  board,
  resolve,
  uppercase,
  found,
  onEdit,
  onAdd,
  onOpen,
  onMove,
}: {
  board: Board;
  resolve: (symbol: Tile['symbol']) => string | null;
  uppercase: boolean;
  /** Tile found with the search, shown with a ring. */
  found: string | null;
  onEdit: (tile: Tile) => void;
  onAdd: (row: number, col: number) => void;
  onOpen: (boardId: string) => void;
  onMove: (tile: Tile, row: number, col: number) => void;
}) {
  const at = useMemo(() => new Map(board.tiles.map((t) => [`${t.row},${t.col}`, t])), [board]);
  const byId = useMemo(() => new Map(board.tiles.map((t) => [t.id, t])), [board]);
  const layout = useGridLayout(board);
  // The click that ends a drag must not open the tile dialog.
  const dragging = useRef(false);

  return (
    <DragDropProvider
      sensors={SENSORS}
      plugins={PLUGINS}
      onDragStart={() => {
        dragging.current = true;
      }}
      onDragEnd={(event) => {
        window.setTimeout(() => (dragging.current = false), 0);
        const tile = byId.get(String(event.operation.source?.id));
        const cell = CELL_ID.exec(String(event.operation.target?.id ?? ''));
        if (event.canceled || !tile || !cell) return;
        const row = Number(cell[1]);
        const col = Number(cell[2]);
        if (row !== tile.row || col !== tile.col) onMove(tile, row, col);
      }}
    >
      <div className="board-area">
        <div
          className="board-grid"
          style={{ '--cols': layout.cols, '--rows': layout.rows } as CSSProperties}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="edit-grid"
        >
          {Array.from({ length: layout.rows * layout.cols }, (_, i) => {
            const { row, col } = cellAt(layout, i);
            const shown = toScreen(layout, { row, col });
            const where = `wiersz ${shown.row + 1}, kolumna ${shown.col + 1}`;
            const tile = at.get(`${row},${col}`);
            return (
              <EditCell key={`${board.id}:${row},${col}`} row={row} col={col} where={where}>
                {tile ? (
                  <EditTile
                    key={tile.id}
                    tile={tile}
                    src={resolve(tile.symbol)}
                    uppercase={uppercase}
                    found={found === tile.id}
                    onEdit={() => !dragging.current && onEdit(tile)}
                    onOpen={onOpen}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={`Dodaj kafelek: ${where}`}
                    onClick={() => onAdd(row, col)}
                    className="edit-empty"
                  >
                    <PlusIcon className="edit-empty-icon" />
                  </button>
                )}
              </EditCell>
            );
          })}
        </div>
      </div>
    </DragDropProvider>
  );
}

function EditCell({
  row,
  col,
  where,
  children,
}: {
  row: number;
  col: number;
  /** Place on screen, for screen readers. */
  where: string;
  children: ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({ id: cellId(row, col) });
  return (
    <div
      ref={ref}
      data-where={where}
      className={`tile-cell ${isDropTarget ? 'edit-drop-target' : ''}`}
    >
      {children}
    </div>
  );
}

function EditTile({
  tile,
  src,
  uppercase,
  found,
  onEdit,
  onOpen,
}: {
  tile: Tile;
  src: string | null;
  uppercase: boolean;
  found: boolean;
  onEdit: () => void;
  onOpen: (boardId: string) => void;
}) {
  const { ref, isDragging } = useDraggable({ id: tile.id, plugins: FEEDBACK });
  const target = tile.targetBoardId;
  return (
    <div
      className={`edit-tile ${isDragging ? 'edit-dragging' : ''} ${tile.hidden ? 'tile-hidden' : ''}`}
    >
      <TileView
        ref={ref}
        tile={tile}
        src={src}
        uppercase={uppercase}
        found={found}
        ariaLabel={`Zmień kafelek: ${tile.label}${target ? ' (folder)' : ''}${tile.hidden ? ' (ukryty)' : ''}`}
        onClick={onEdit}
      />
      {tile.hidden && (
        <span className="tile-hidden-badge" aria-hidden="true">
          ukryty
        </span>
      )}
      {target && (
        <button
          type="button"
          aria-label={`Otwórz folder ${tile.label}`}
          onClick={() => onOpen(target)}
          className="edit-open"
        >
          <OpenIcon className="edit-open-icon" />
        </button>
      )}
    </div>
  );
}
