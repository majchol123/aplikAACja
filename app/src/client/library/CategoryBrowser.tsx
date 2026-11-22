import type { LibrarySet, Me, Settings, SymbolHit } from '@relaacja/shared';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { FolderIcon } from '../comm/icons.tsx';
import { ui } from '../edit/ui.ts';
import { FolderIconEditor, IconChoice } from './FolderIconEditor.tsx';
import { useCategories, useSetFolderIcon } from './useCategories.ts';

/** Symbols shown at once; "Pokaż więcej" adds as many (Czasownik alone has 2457). */
const PAGE = 60;

/**
 * Category folders of the active sets (F2 step 6): the top level of a set, its subfolders
 * and the symbols of the open folder. Read-only and virtual — nothing here is a board.
 */
export function CategoryBrowser({
  me,
  active,
  renderSymbol,
  className = '',
  canEditIcons = false,
}: {
  me: Me;
  active?: Settings['activeSets'];
  /** Admins: folder pictures can be changed for every account. */
  canEditIcons?: boolean;
  /** Content of one symbol cell (a pick button in the editor, a plain card elsewhere). */
  renderSymbol: (hit: SymbolHit, setName: string) => ReactNode;
  /** Classes of the scrolling area with the folders and symbols. */
  className?: string;
}) {
  const categories = useCategories(me, active);
  const [chosen, setChosen] = useState<LibrarySet | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const id = useId();
  const area = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const setIcon = useSetFolderIcon();

  const current = categories.sets.find((s) => s.set === chosen) ?? categories.sets[0];
  const { filter } = categories;
  const view = useMemo(() => {
    if (!current || !filter) return null;
    return (
      current.tree.view(at, filter, current.icons) ?? current.tree.view(null, filter, current.icons)
    );
  }, [current, at, filter]);

  // After opening a folder: back to the top of the list, focus on its name.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    area.current?.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [view?.id, view?.set]);

  function open(folder: number | null): void {
    moved.current = true;
    setNotice('');
    setAt(folder);
    setShown(PAGE);
  }

  function switchSet(set: LibrarySet): void {
    setChosen(set);
    open(null);
  }

  if (categories.failed.length) {
    return (
      <p className="mt-2 text-sm text-red-800" role="alert">
        Nie udało się wczytać kategorii: {categories.failed.join(', ')}.
      </p>
    );
  }
  if (categories.loading && !view) {
    return (
      <p className="mt-2 text-sm text-slate-600" role="status">
        Wczytywanie kategorii…
      </p>
    );
  }
  if (!current || !view) {
    return (
      <p className="mt-2 text-sm text-slate-600" role="status">
        {categories.none
          ? 'Kategorie aktywnych zestawów nie są jeszcze dostępne.'
          : 'Brak aktywnych zestawów symboli.'}
      </p>
    );
  }

  const name = view.path.at(-1)?.name ?? `Kategorie: ${current.name}`;
  const editable = canEditIcons && editing && view.folder?.key ? view.folder : null;
  const choose = (symbol: SymbolHit | null) => {
    if (!editable?.key) return;
    setNotice('');
    setIcon.mutate(
      { set: current.set, key: editable.key, symbol: symbol ? symbol.id : null },
      {
        onSuccess: () =>
          setNotice(
            symbol
              ? `Zapisano obrazek folderu „${editable.name}”: ${symbol.label}.`
              : `Przywrócono automatyczny obrazek folderu „${editable.name}”.`,
          ),
      },
    );
  };
  const symbols = view.symbols.slice(0, shown);
  const more = view.symbols.length - symbols.length;
  const summary = [
    view.folders.length ? `podkategorie: ${view.folders.length}` : '',
    view.id !== null ? `symbole: ${view.symbols.length}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mt-2">
      {categories.sets.length > 1 && (
        <fieldset className="mb-3">
          <legend className={ui.field}>Zestaw</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {categories.sets.map((s) => (
              <label key={s.set} className={ui.choice}>
                <input
                  type="radio"
                  name={`${id}-set`}
                  className="sr-only"
                  checked={s.set === current.set}
                  onChange={() => switchSet(s.set)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <nav aria-label="Ścieżka kategorii">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          <li>
            {view.id === null ? (
              <span aria-current="page" className="font-semibold text-slate-800">
                Wszystkie kategorie
              </span>
            ) : (
              <button
                type="button"
                className="text-brand-800 underline underline-offset-4"
                onClick={() => open(null)}
              >
                Wszystkie kategorie
              </button>
            )}
          </li>
          {view.path.map((step, i) => (
            <li key={step.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-slate-400">
                ›
              </span>
              {i === view.path.length - 1 ? (
                <span aria-current="page" className="font-semibold text-slate-800">
                  {step.name}
                </span>
              ) : (
                <button
                  type="button"
                  className="text-brand-800 underline underline-offset-4"
                  onClick={() => open(step.id)}
                >
                  {step.name}
                </button>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <h3
        ref={heading}
        tabIndex={-1}
        className="mt-2 text-base font-bold text-brand-900 outline-none"
      >
        {name}
      </h3>
      <p className="min-h-5 text-sm text-slate-600" role="status" aria-live="polite">
        {summary || 'Pusta kategoria — filtr treści ukrywa jej symbole.'}
      </p>

      {canEditIcons && (
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="size-5 accent-brand-700"
            checked={editing}
            onChange={(e) => {
              setEditing(e.target.checked);
              setNotice('');
            }}
          />
          Zmieniaj obrazki folderów (administrator, dla wszystkich kont)
        </label>
      )}
      {canEditIcons && editing && !editable && (
        <p className="mt-1 text-sm text-slate-600">
          Otwórz folder, którego obrazek chcesz zmienić.
        </p>
      )}
      {editable && (
        <FolderIconEditor
          me={me}
          active={active}
          set={current.set}
          folder={editable}
          busy={setIcon.isPending}
          onChoose={choose}
          onReset={() => choose(null)}
        />
      )}
      <p className="mt-1 min-h-5 text-sm text-brand-800" role="status" aria-live="polite">
        {notice}
      </p>
      {setIcon.isError && (
        <p className="mt-1 text-sm text-red-800" role="alert">
          Nie udało się zapisać obrazka folderu. Spróbuj ponownie.
        </p>
      )}

      <div ref={area} className={`mt-2 overflow-y-auto p-1 ${className}`}>
        {view.folders.length > 0 && (
          <ul
            className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2"
            aria-label="Podkategorie"
            data-testid="category-folders"
          >
            {view.folders.map((folder) => (
              <li key={folder.id} className="relative">
                <button
                  type="button"
                  aria-label={`${folder.name}, kategoria, symboli: ${folder.count}`}
                  onClick={() => open(folder.id)}
                  className="relative flex w-full flex-col items-center rounded-xl border-4 border-brand-300 bg-brand-50 p-1.5 pb-5 hover:bg-brand-100"
                >
                  {!folder.ownIcon && (
                    <span className="absolute left-1 top-1 text-brand-700">
                      <FolderIcon />
                    </span>
                  )}
                  {folder.icon ? (
                    <img
                      src={folder.icon}
                      alt=""
                      width={80}
                      height={80}
                      loading="lazy"
                      decoding="async"
                      className="size-20 rounded-md object-contain"
                    />
                  ) : (
                    <span className="size-20" />
                  )}
                  <span className="mt-1 line-clamp-2 text-center text-sm font-semibold leading-tight text-slate-800">
                    {folder.name}
                  </span>
                </button>
                {/* Outside the button: its visible text stays a part of its name (WCAG 2.5.3). */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-xs tabular-nums text-slate-500"
                >
                  {folder.count}
                </span>
              </li>
            ))}
          </ul>
        )}

        {symbols.length > 0 && (
          <ul
            className={`grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 ${
              view.folders.length ? 'mt-3' : ''
            }`}
            aria-label={`Symbole: ${name}`}
            data-testid="category-symbols"
          >
            {symbols.map((hit) => (
              <li key={`${hit.set}:${hit.id}`}>
                {editable ? (
                  <IconChoice
                    hit={hit}
                    folder={editable.name}
                    disabled={setIcon.isPending}
                    onChoose={choose}
                  />
                ) : (
                  renderSymbol(hit, current.name)
                )}
              </li>
            ))}
          </ul>
        )}

        {more > 0 && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              className={ui.secondary}
              onClick={() => setShown((n) => n + PAGE)}
            >
              Pokaż więcej (jeszcze {more})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
