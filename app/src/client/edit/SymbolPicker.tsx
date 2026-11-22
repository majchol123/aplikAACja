import {
  labelMatches,
  mediaUrl,
  type FitzgeraldRole,
  type Me,
  type SymbolHit,
  type SymbolRef,
} from '@relaacja/shared';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { ROLE_COLORS } from '../boards/colors.ts';
import { isPreferred, usePreferredSymbols } from '../boards/preferred.ts';
import { StarIcon } from '../comm/icons.tsx';
import { ARASAAC_NOTE } from '../library/attribution.ts';
import { CategoryBrowser } from '../library/CategoryBrowser.tsx';
import { useLibrary } from '../library/useLibrary.ts';
import { useMediaList } from '../media/data.ts';
import { ui } from './ui.ts';

const LIMIT = 48;

/** One picture to choose from: a library symbol or an own photo. */
export interface PickerItem {
  symbol: SymbolRef;
  /** Keyword of the symbol or name of the photo: the word its preferred variant is for. */
  word: string;
  /** Part of speech (library symbols only). */
  role: FitzgeraldRole | null;
  src: string;
  source: string;
  description: string;
}

const key = (s: SymbolRef) => `${s.set}:${s.ref}`;

const fromHit = (h: SymbolHit, source: string): PickerItem => ({
  symbol: { set: h.set, ref: String(h.id) },
  word: h.label,
  role: h.role,
  src: h.src,
  source,
  description: `${h.label}, ${source}, nr ${h.id}`,
});

/**
 * Library search showing every graphic variant of a word side by side, own photos among
 * them (PLAN §2.2); the variant picked last for a word comes first, marked with a star.
 * With no query, the newest own photos are shown.
 */
export function SymbolPicker({
  me,
  query,
  onQuery,
  selected,
  onPick,
}: {
  me: Me;
  query: string;
  onQuery: (query: string) => void;
  selected: SymbolRef | null;
  onPick: (item: PickerItem) => void;
}) {
  const library = useLibrary(me);
  const photos = useMediaList();
  const preferred = usePreferredSymbols();
  const deferred = useDeferredValue(query);
  const [mode, setMode] = useState<'search' | 'browse'>('search');
  const id = useId();
  const { search, setNames } = library;
  const typed = deferred.trim() !== '';

  const items = useMemo(() => {
    const own: PickerItem[] = (photos.data?.items ?? [])
      .filter((p) => !typed || labelMatches(p.label, deferred))
      .slice(0, LIMIT)
      .map((p) => ({
        symbol: { set: 'own', ref: p.id },
        word: p.label,
        role: null,
        src: mediaUrl(p.id),
        source: 'Moje zdjęcia',
        description: `${p.label}, Moje zdjęcia`,
      }));
    const found = (typed ? search(deferred, LIMIT) : []).map((h) => fromHit(h, setNames[h.set]));
    const all = [...own, ...found];
    const first = all.filter((i) => isPreferred(preferred.data, i.word, i.symbol));
    return first.length ? [...first, ...all.filter((i) => !first.includes(i))] : all;
  }, [photos.data, typed, deferred, search, setNames, preferred.data]);

  const libraryCount = items.filter((i) => i.symbol.set !== 'own').length;
  const status = library.failed.length
    ? `Nie udało się wczytać: ${library.failed.join(', ')}.`
    : library.loading
      ? 'Wczytywanie biblioteki…'
      : typed
        ? items.length
          ? `Wariantów: ${items.length}${libraryCount === LIMIT ? '+' : ''}`
          : 'Brak symboli dla tego słowa.'
        : items.length
          ? 'Twoje zdjęcia. Wpisz słowo, aby zobaczyć też symbole.'
          : 'Wpisz słowo, aby zobaczyć symbole.';

  const tile = (item: PickerItem) => (
    <PickerTile
      item={item}
      chosen={selected !== null && key(selected) === key(item.symbol)}
      star={isPreferred(preferred.data, item.word, item.symbol)}
      onPick={onPick}
    />
  );

  return (
    <div>
      <fieldset>
        <legend className="sr-only">Jak wybrać symbol</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['search', 'Szukaj'],
              ['browse', 'Kategorie'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={ui.choice}>
              <input
                type="radio"
                name={`${id}-mode`}
                className="sr-only"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'search' ? (
        <div className="mt-3">
          <label htmlFor={id} className={ui.field}>
            Szukaj symbolu
          </label>
          <input
            id={id}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="np. jabłko, pić, dzień dobry"
            className={ui.input}
          />
          <p className="mt-1 min-h-5 text-sm text-slate-600" role="status" aria-live="polite">
            {status}
          </p>
          {items.length > 0 && (
            <ul
              className="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto p-1"
              aria-label="Symbole"
              data-testid="symbol-results"
            >
              {items.map((item) => (
                <li key={key(item.symbol)}>{tile(item)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <CategoryBrowser
          me={me}
          className="max-h-80"
          renderSymbol={(hit, source) => tile(fromHit(hit, source))}
        />
      )}
      {library.usesArasaac && <p className="mt-2 text-xs text-slate-500">{ARASAAC_NOTE}</p>}
    </div>
  );
}

function PickerTile({
  item,
  chosen,
  star,
  onPick,
}: {
  item: PickerItem;
  chosen: boolean;
  star: boolean;
  onPick: (item: PickerItem) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={`${item.description}${star ? ', ulubiony wariant' : ''}`}
      onClick={() => onPick(item)}
      className={`relative flex w-full flex-col items-center rounded-xl border-4 bg-white p-1.5 ${
        ROLE_COLORS[item.role ?? 'none'].border
      } ${chosen ? 'outline-4 outline-offset-2 outline-brand-700' : ''}`}
    >
      {star && (
        <span className="absolute left-1 top-1 text-amber-500">
          <StarIcon />
        </span>
      )}
      <img
        src={item.src}
        alt=""
        width={80}
        height={80}
        loading="lazy"
        decoding="async"
        className="size-20 rounded-md object-contain"
      />
      <span className="mt-1 line-clamp-2 text-center text-sm font-semibold leading-tight text-slate-800">
        {item.word}
      </span>{' '}
      {/* The space keeps the visible text a part of the accessible name (WCAG 2.5.3). */}
      <span className="text-xs text-slate-500">{item.source}</span>
    </button>
  );
}
