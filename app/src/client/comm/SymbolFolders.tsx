import type { Board, FitzgeraldRole, LibrarySet, Me, SymbolRef, Tile } from '@aplikaacja/shared';
import { useMemo, type ReactNode } from 'react';
import { ALL_SYMBOLS_TILE } from '../boards/allSymbols.ts';
import { BoardNav } from '../boards/BoardNav.tsx';
import { useCategories } from '../library/useCategories.ts';
import { BoardGrid } from './BoardGrid.tsx';

/** Symbols drawn at once; the last cell then shows more (Czasownik alone has 2457). */
const PAGE = 120;
/** ARASAAC "więcej" for the cell that shows the next symbols. */
const MORE_PICTURE: SymbolRef = { set: 'arasaac', ref: '5508' };

/** Where "Wszystkie symbole" is open: a set (null: the choice between sets) and a folder. */
export interface Browse {
  set: LibrarySet | null;
  folder: number | null;
  shown: number;
}
export const BROWSE_START: Browse = { set: null, folder: null, shown: PAGE };

export interface PickedSymbol {
  label: string;
  src: string;
  symbol: SymbolRef;
  /** The symbol's part of speech (grammar, F8). */
  role: FitzgeraldRole | null;
}

const cell = (
  id: string,
  i: number,
  cols: number,
  label: string,
  kind: Tile['kind'],
  extra: Partial<Tile> = {},
): Tile => ({
  id,
  row: Math.floor(i / cols),
  col: i % cols,
  kind,
  targetBoardId: null,
  label,
  labelPosition: null,
  fontSize: 'M',
  colorRole: null,
  colorMode: 'border',
  symbol: null,
  hidden: false,
  speech: null,
  ...extra,
});

/**
 * "Wszystkie symbole" of communication mode (F3): the category folders of the active sets
 * drawn like boards — folders first, then the symbols of the open folder — for someone who
 * cannot type a search. Nothing here is a board of the account; a symbol goes to the
 * sentence bar like a tile.
 */
export function SymbolFolders({
  me,
  browse,
  home,
  boards,
  cols,
  resolve,
  tools,
  onBrowse,
  onHome,
  onPick,
}: {
  me: Me;
  browse: Browse;
  home: Board;
  boards: Map<string, Board>;
  /** Columns of the drawn grid (those of the home board). */
  cols: number;
  /** Pictures of library symbols by reference (the board resolver). */
  resolve: (symbol: Tile['symbol']) => string | null;
  /** Buttons at the right end of the navigation (search, history…). */
  tools: ReactNode;
  onBrowse: (next: Browse | null) => void;
  /** Leave for a board (the home board, or one from the path). */
  onHome: (boardId: string) => void;
  onPick: (item: PickedSymbol) => void;
}) {
  const categories = useCategories(me);
  const { sets, filter } = categories;
  const several = sets.length > 1;
  const current = sets.find((s) => s.set === browse.set) ?? (several ? null : sets[0]);
  const view = useMemo(() => {
    if (!current || !filter) return null;
    return (
      current.tree.view(browse.folder, filter, current.icons) ??
      current.tree.view(null, filter, current.icons)
    );
  }, [current, browse.folder, filter]);

  const level = useMemo(() => {
    const srcs = new Map<string, string>();
    const tiles: Tile[] = [];
    let more = 0;
    if (!current) {
      // Several sets: each is a folder, pictured by its first category.
      for (const set of sets) {
        const top = filter ? set.tree.view(null, filter, set.icons) : null;
        const id = `set:${set.set}`;
        tiles.push(cell(id, tiles.length, cols, set.name, 'folder'));
        const icon = top?.folders.find((f) => f.icon)?.icon;
        if (icon) srcs.set(id, icon);
      }
    } else if (view) {
      for (const folder of view.folders) {
        const id = `cat:${folder.id}`;
        tiles.push(cell(id, tiles.length, cols, folder.name, 'folder'));
        if (folder.icon) srcs.set(id, folder.icon);
      }
      const symbols = view.symbols.slice(0, browse.shown);
      more = view.symbols.length - symbols.length;
      for (const hit of symbols) {
        const id = `sym:${hit.set}:${hit.id}`;
        tiles.push(
          cell(id, tiles.length, cols, hit.label, 'word', {
            colorRole: hit.role,
            symbol: { set: hit.set, ref: String(hit.id) },
          }),
        );
        srcs.set(id, hit.src);
      }
      if (more > 0) {
        tiles.push(
          cell('more', tiles.length, cols, `więcej (${more})`, 'word', { symbol: MORE_PICTURE }),
        );
      }
    }
    const board: Board = {
      id: `symbols:${current?.set ?? 'sets'}:${view?.id ?? 'top'}`,
      name: view?.path.at(-1)?.name ?? current?.name ?? ALL_SYMBOLS_TILE.label,
      parentId: home.id,
      rows: Math.max(1, Math.ceil(tiles.length / cols)),
      cols,
      rev: 1,
      tiles,
    };
    return { board, srcs, more };
  }, [current, view, sets, filter, cols, browse.shown, home.id]);

  const open = (next: Partial<Browse>) => onBrowse({ ...browse, shown: PAGE, ...next });
  const trail = [
    {
      key: 'all',
      name: ALL_SYMBOLS_TILE.label,
      onOpen: () => onBrowse(BROWSE_START),
    },
    ...(several && current
      ? [{ key: `set:${current.set}`, name: current.name, onOpen: () => open({ folder: null }) }]
      : []),
    ...(view?.path ?? []).map((step) => ({
      key: `cat:${step.id}`,
      name: step.name,
      onOpen: () => open({ folder: step.id }),
    })),
  ];
  // Up one level: the parent folder, the choice of sets, then the home board.
  const back = () => {
    const path = view?.path ?? [];
    if (current && path.length > 0) open({ folder: path.at(-2)?.id ?? null });
    else if (current && several) onBrowse(BROWSE_START);
    else onHome(home.id);
  };

  function activate(tile: Tile): void {
    if (tile.id === 'more') {
      onBrowse({ ...browse, shown: browse.shown + PAGE });
      return;
    }
    const [kind, key] = tile.id.split(':');
    if (kind === 'set') open({ set: key as LibrarySet, folder: null });
    else if (kind === 'cat') open({ folder: Number(key) });
    else if (kind === 'sym' && tile.symbol) {
      onPick({
        label: tile.label,
        src: level.srcs.get(tile.id) ?? '',
        symbol: tile.symbol,
        role: tile.colorRole,
      });
    }
  }

  let notice: string | null = null;
  if (categories.failed.length) {
    notice = `Nie udało się wczytać kategorii: ${categories.failed.join(', ')}.`;
  } else if (categories.loading && !view && sets.length === 0) {
    notice = 'Wczytywanie kategorii…';
  } else if (sets.length === 0) {
    notice = categories.none
      ? 'Kategorie aktywnych zestawów nie są jeszcze dostępne.'
      : 'Brak aktywnych zestawów symboli.';
  } else if (view && level.board.tiles.length === 0) {
    notice = 'Pusta kategoria — filtr treści ukrywa jej symbole.';
  }

  return (
    <>
      <BoardNav
        boards={boards}
        board={home}
        homeId={home.id}
        onOpen={onHome}
        trail={trail}
        onBack={back}
        className="[grid-area:nav]"
      >
        {tools}
      </BoardNav>
      {notice ? (
        <div className="board-area items-center [grid-area:board]">
          <p
            role={categories.failed.length ? 'alert' : 'status'}
            className="text-lg text-slate-600"
          >
            {notice}
          </p>
        </div>
      ) : (
        <BoardGrid
          board={level.board}
          srcOf={(tile) => level.srcs.get(tile.id) ?? resolve(tile.symbol)}
          found={null}
          onActivate={activate}
        />
      )}
    </>
  );
}
