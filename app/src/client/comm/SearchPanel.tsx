import {
  labelSearch,
  type Board,
  type BoardTree,
  type Me,
  type Settings,
  type SymbolHit,
  type SymbolRef,
  type Tile,
} from '@relaacja/shared';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { boardPath } from '../boards/BoardNav.tsx';
import { Dialog } from '../edit/Dialog.tsx';
import { ui } from '../edit/ui.ts';
import { useManifest, useSymbolSet } from '../library/data.ts';
import { useLibrary } from '../library/useLibrary.ts';
import { FolderIcon } from './icons.tsx';

type Source = 'tiles' | 'library';

/** Search over the account's own tiles, with the same rules as the symbol library. */
function useTileSearch(me: Me, tree: BoardTree) {
  const manifest = useManifest('arasaac', true);
  const lexicon = useSymbolSet(manifest.data, true).data?.lexicon;
  return useMemo(() => {
    const tiles = tree.boards.flatMap((board) => board.tiles.map((tile) => ({ tile, board })));
    const find = labelSearch(
      tiles.map((t) => t.tile.label),
      lexicon ? [lexicon] : [],
    );
    return (query: string) => find(query, 40).flatMap((i) => (tiles[i] ? [tiles[i]] : []));
  }, [tree.boards, lexicon]);
}

/**
 * The search of communication mode (PLAN §2.1): own tiles (with where they are; tapping
 * one shows it on its board) and the symbol library (tapping one says it and adds it to
 * the sentence). Which of them, and in what order, comes from the account settings.
 */
export function SearchPanel({
  me,
  tree,
  sources,
  resolve,
  onShowTile,
  onPick,
  onClose,
}: {
  me: Me;
  tree: BoardTree;
  sources: Settings['searchSources'];
  resolve: (symbol: Tile['symbol']) => string | null;
  onShowTile: (tile: Tile, board: Board) => void;
  onPick: (item: { label: string; src: string; symbol: SymbolRef }) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const available: Source[] = sources === 'both' ? ['tiles', 'library'] : [sources];
  const [source, setSource] = useState<Source>(available[0] ?? 'tiles');
  const findTiles = useTileSearch(me, tree);
  const library = useLibrary(me);
  const boards = useMemo(() => new Map(tree.boards.map((b) => [b.id, b])), [tree.boards]);

  const tileHits = useMemo(
    () => (source === 'tiles' && deferred.trim() ? findTiles(deferred) : []),
    [source, deferred, findTiles],
  );
  const libraryHits = useMemo<SymbolHit[]>(
    () => (source === 'library' && deferred.trim() ? library.search(deferred, 36) : []),
    [source, deferred, library],
  );
  const searched = deferred.trim() !== '';
  const nothing =
    searched && (source === 'tiles' ? tileHits.length === 0 : libraryHits.length === 0);

  return (
    <Dialog title="Szukaj" onClose={onClose} wide>
      <label htmlFor={`${id}-q`} className="sr-only">
        Czego szukasz?
      </label>
      <input
        id={`${id}-q`}
        type="search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Wpisz słowo"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${ui.input} mt-3 text-xl`}
      />
      {available.length > 1 && (
        <div role="tablist" aria-label="Gdzie szukać" className="mt-3 flex gap-2">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={source === s}
              onClick={() => setSource(s)}
              className="rounded-full border-2 border-slate-200 px-4 py-2 font-semibold text-slate-700 aria-selected:border-brand-700 aria-selected:bg-brand-50 aria-selected:text-brand-900"
            >
              {s === 'tiles' ? 'Moje kafelki' : 'Biblioteka symboli'}
            </button>
          ))}
        </div>
      )}
      <div role={available.length > 1 ? 'tabpanel' : undefined} className="mt-3">
        {nothing && <p className="text-slate-600">Nic nie znaleziono.</p>}
        {source === 'library' && library.size === 0 && searched && (
          <p role="status" className="text-slate-600">
            Wczytywanie symboli…
          </p>
        )}
        {source === 'tiles' && tileHits.length > 0 && (
          <ul className="space-y-2" aria-label="Znalezione kafelki">
            {tileHits.map(({ tile, board }) => {
              const src = resolve(tile.symbol);
              const where = boardPath(boards, board)
                .map((b) => b.name)
                .join(' › ');
              return (
                <li key={tile.id}>
                  <button
                    type="button"
                    onClick={() => onShowTile(tile, board)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-white p-2 text-left ring-1 ring-slate-200 hover:bg-brand-50"
                  >
                    {src ? (
                      <img src={src} alt="" className="size-14 shrink-0 object-contain" />
                    ) : (
                      <span className="size-14 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-lg font-bold text-slate-900">
                        {tile.label}
                        {tile.kind === 'folder' && <FolderIcon className="size-5 text-slate-500" />}
                      </span>
                      <span className="block truncate text-sm text-slate-600">{where}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {source === 'library' && libraryHits.length > 0 && (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2"
            aria-label="Znalezione symbole"
          >
            {libraryHits.map((hit) => (
              <li key={`${hit.set}:${hit.id}`}>
                <button
                  type="button"
                  onClick={() =>
                    onPick({
                      label: hit.label,
                      src: hit.src,
                      symbol: { set: hit.set, ref: String(hit.id) },
                    })
                  }
                  className="flex w-full flex-col items-center rounded-2xl bg-white p-2 ring-1 ring-slate-200 hover:bg-brand-50"
                >
                  <img src={hit.src} alt="" className="size-20 object-contain" loading="lazy" />
                  <span className="mt-1 text-center font-bold leading-tight text-slate-900">
                    {hit.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
