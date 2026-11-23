import type { CategoryFolder, LibrarySet, Me, Settings, SymbolHit } from '@aplikaacja/shared';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { ui } from '../edit/ui.ts';
import { useLibrary } from './useLibrary.ts';

const RESULTS = 24;

/** One symbol offered as the picture of a folder (admin editing). */
export function IconChoice({
  hit,
  folder,
  disabled,
  onChoose,
}: {
  hit: SymbolHit;
  folder: string;
  disabled: boolean;
  onChoose: (hit: SymbolHit) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Ustaw jako obrazek folderu „${folder}”: ${hit.label}`}
      onClick={() => onChoose(hit)}
      className="flex w-full flex-col items-center rounded-xl border-4 border-dashed border-amber-400 bg-white p-1.5 hover:bg-amber-50 disabled:opacity-50"
    >
      <img
        src={hit.src}
        alt=""
        width={80}
        height={80}
        loading="lazy"
        decoding="async"
        className="size-20 rounded-md object-contain"
      />
      <span className="mt-1 line-clamp-2 text-center text-sm font-semibold leading-tight text-slate-800">
        {hit.label}
      </span>
    </button>
  );
}

/**
 * Admin panel of the open folder: its current picture, back to the automatic one, and a
 * search over the whole set for symbols that are not in the folder itself.
 */
export function FolderIconEditor({
  me,
  active,
  set,
  folder,
  busy,
  onChoose,
  onReset,
}: {
  me: Me;
  active?: Settings['activeSets'];
  set: LibrarySet;
  folder: CategoryFolder;
  busy: boolean;
  onChoose: (hit: SymbolHit) => void;
  onReset: () => void;
}) {
  const library = useLibrary(me, active);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const id = useId();
  const { search } = library;
  const hits = useMemo(
    () =>
      deferred.trim()
        ? search(deferred, 120)
            .filter((h) => h.set === set)
            .slice(0, RESULTS)
        : [],
    [search, deferred, set],
  );

  return (
    <section
      className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200"
      aria-labelledby={`${id}-title`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {folder.icon ? (
          <img
            src={folder.icon}
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-md bg-white object-contain"
          />
        ) : (
          <span className="size-16 rounded-md bg-white" />
        )}
        <div className="min-w-0 flex-1">
          <h4 id={`${id}-title`} className="font-semibold text-slate-800">
            Obrazek folderu „{folder.name}”
          </h4>
          <p className="text-sm text-slate-600">
            {folder.custom
              ? 'Wybrany przez administratora — widzą go wszyscy.'
              : 'Automatyczny. Dotknij symbolu w folderze albo znajdź inny w zestawie.'}
          </p>
        </div>
        {folder.custom && (
          <button type="button" className={ui.secondary} disabled={busy} onClick={onReset}>
            Przywróć automatyczny
          </button>
        )}
      </div>
      <label htmlFor={`${id}-q`} className={`${ui.field} mt-3`}>
        Szukaj obrazka w zestawie
      </label>
      <input
        id={`${id}-q`}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={ui.input}
      />
      {hits.length > 0 && (
        <ul
          className="mt-2 grid max-h-64 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto p-1"
          aria-label="Obrazki do wyboru"
        >
          {hits.map((hit) => (
            <li key={hit.id}>
              <IconChoice hit={hit} folder={folder.name} disabled={busy} onChoose={onChoose} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
