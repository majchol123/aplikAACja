import type { Me, SymbolHit, SymbolRef } from '@relaacja/shared';
import { useDeferredValue, useId, useMemo } from 'react';
import { ROLE_COLORS } from '../boards/colors.ts';
import { isPreferred, usePreferredSymbols } from '../boards/preferred.ts';
import { StarIcon } from '../comm/icons.tsx';
import { ARASAAC_NOTE } from '../library/attribution.ts';
import { useLibrary } from '../library/useLibrary.ts';
import { ui } from './ui.ts';

const LIMIT = 48;

export const hitSymbol = (hit: SymbolHit): SymbolRef => ({ set: hit.set, ref: String(hit.id) });

/**
 * Library search showing every graphic variant of a word side by side (PLAN §2.2); the
 * variant picked last for a word comes first, marked with a star.
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
  onPick: (hit: SymbolHit) => void;
}) {
  const library = useLibrary(me);
  const preferred = usePreferredSymbols();
  const deferred = useDeferredValue(query);
  const id = useId();
  const { search } = library;

  const hits = useMemo(() => {
    const found = search(deferred, LIMIT);
    const first = found.filter((h) => isPreferred(preferred.data, h.label, hitSymbol(h)));
    return first.length ? [...first, ...found.filter((h) => !first.includes(h))] : found;
  }, [search, deferred, preferred.data]);

  const status = library.failed.length
    ? `Nie udało się wczytać: ${library.failed.join(', ')}.`
    : library.loading
      ? 'Wczytywanie biblioteki…'
      : deferred.trim()
        ? hits.length
          ? `Wariantów: ${hits.length}${hits.length === LIMIT ? '+' : ''}`
          : 'Brak symboli dla tego słowa.'
        : 'Wpisz słowo, aby zobaczyć symbole.';

  return (
    <div>
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
      {hits.length > 0 && (
        <ul
          className="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto p-1"
          aria-label="Symbole"
          data-testid="symbol-results"
        >
          {hits.map((hit) => {
            const symbol = hitSymbol(hit);
            const chosen = selected?.set === symbol.set && selected.ref === symbol.ref;
            const star = isPreferred(preferred.data, hit.label, symbol);
            return (
              <li key={`${hit.set}:${hit.id}`}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`${hit.label} (${library.setNames[hit.set]}, nr ${hit.id})${star ? ', ulubiony wariant' : ''}`}
                  onClick={() => onPick(hit)}
                  className={`relative flex w-full flex-col items-center rounded-xl border-4 bg-white p-1.5 ${
                    ROLE_COLORS[hit.role].border
                  } ${chosen ? 'outline-4 outline-offset-2 outline-brand-700' : ''}`}
                >
                  {star && (
                    <span className="absolute left-1 top-1 text-amber-500">
                      <StarIcon />
                    </span>
                  )}
                  <img
                    src={hit.src}
                    alt=""
                    width={80}
                    height={80}
                    loading="lazy"
                    decoding="async"
                    className="size-20 object-contain"
                  />
                  <span className="mt-1 line-clamp-2 text-center text-sm font-semibold leading-tight text-slate-800">
                    {hit.label}
                  </span>
                  <span className="text-xs text-slate-500">{library.setNames[hit.set]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {library.usesArasaac && <p className="mt-2 text-xs text-slate-500">{ARASAAC_NOTE}</p>}
    </div>
  );
}
