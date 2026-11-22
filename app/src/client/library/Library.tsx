import type { LibrarySet, Me, Settings, SymbolHit } from '@relaacja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { ROLE_COLORS } from '../boards/colors.ts';
import { useAccountSettings } from '../settings/account.ts';
import { ui } from '../edit/ui.ts';
import { ARASAAC_NOTE } from './attribution.ts';
import { CategoryBrowser } from './CategoryBrowser.tsx';
import { ContentFilter } from './ContentFilter.tsx';
import { useLibrary } from './useLibrary.ts';

/** Active symbol sets and a browser over them (settings screen). */
export function Library({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const settings = useAccountSettings();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'browse'>('search');
  const deferredQuery = useDeferredValue(query);
  const inputId = useId();

  // Shown immediately while the PATCH is in flight (a controlled checkbox must change
  // within the click event); cleared when the server answers.
  const [pendingSets, setPendingSets] = useState<Settings['activeSets'] | null>(null);
  const library = useLibrary(me, pendingSets ?? undefined);
  const active = library.sets;

  const updateSets = useMutation({
    mutationFn: (activeSets: Settings['activeSets']) =>
      api<Settings>('/api/settings', { method: 'PATCH', json: { activeSets } }),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
    onSettled: () => setPendingSets(null),
  });

  const { search } = library;
  const hits = useMemo(() => search(deferredQuery), [search, deferredQuery]);

  function toggle(set: LibrarySet, on: boolean): void {
    if (!settings.data) return;
    const next = on ? [...active.filter((s) => s !== set), set] : active.filter((s) => s !== set);
    if (next.length === 0) return;
    setPendingSets(next);
    updateSets.mutate(next);
  }

  const offered: LibrarySet[] = me.extraSet ? ['arasaac', 'extra'] : ['arasaac'];
  const isOffered = (s: Settings['activeSets'][number]): s is LibrarySet =>
    (offered as string[]).includes(s);
  // Search ranks results by the order of the active sets (PLAN §3.3).
  const ordered = active.filter(isOffered);

  function moveUp(set: LibrarySet): void {
    const above = ordered[ordered.indexOf(set) - 1];
    if (above === undefined || !settings.data) return;
    const next = active.map((s) => (s === set ? above : s === above ? set : s));
    setPendingSets(next);
    updateSets.mutate(next);
  }

  return (
    <section
      className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100"
      aria-labelledby={`${inputId}-title`}
    >
      <h2 id={`${inputId}-title`} className="text-lg font-bold text-brand-900">
        Biblioteka symboli
      </h2>

      <fieldset className="mt-3 flex flex-wrap gap-x-6 gap-y-2" disabled={!settings.data}>
        <legend className="sr-only">Aktywne zestawy symboli</legend>
        {offered.map((set) => (
          <label key={set} className="flex items-center gap-2 text-slate-700">
            <input
              type="checkbox"
              className="size-5 accent-brand-700"
              checked={active.includes(set)}
              onChange={(e) => toggle(set, e.target.checked)}
            />
            {library.setNames[set]}
          </label>
        ))}
      </fieldset>

      {ordered.length > 1 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-700">Kolejność w wynikach</p>
          <ol className="mt-1 space-y-1">
            {ordered.map((set, i) => (
              <li key={set} className="flex items-center gap-3 text-slate-700">
                <span className="w-5 text-right tabular-nums">{i + 1}.</span>
                {library.setNames[set]}
                {i > 0 && (
                  <button
                    type="button"
                    className="text-sm text-brand-800 underline underline-offset-4"
                    disabled={updateSets.isPending}
                    aria-label={`Przenieś wyżej: ${library.setNames[set]}`}
                    onClick={() => moveUp(set)}
                  >
                    Wyżej
                  </button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <ContentFilter />

      <fieldset className="mt-4">
        <legend className="sr-only">Jak przeglądać bibliotekę</legend>
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
                name={`${inputId}-mode`}
                className="sr-only"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'browse' ? (
        <CategoryBrowser
          me={me}
          active={pendingSets ?? undefined}
          className="max-h-[32rem]"
          canEditIcons={me.role === 'admin' || me.role === 'superadmin'}
          renderSymbol={(hit, setName) => <LibraryCard hit={hit} setName={setName} />}
        />
      ) : (
        <>
          <label htmlFor={inputId} className="mt-4 block text-sm font-medium text-slate-700">
            Szukaj symbolu
          </label>
          <input
            id={inputId}
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="np. jabłko, pić, dzień dobry"
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
          />

          <p className="mt-2 min-h-5 text-sm text-slate-600" role="status" aria-live="polite">
            {library.failed.length
              ? `Nie udało się wczytać: ${library.failed.join(', ')}.`
              : library.loading
                ? 'Wczytywanie biblioteki…'
                : deferredQuery.trim()
                  ? hits.length
                    ? `Znaleziono: ${hits.length}${hits.length === 60 ? '+' : ''}`
                    : 'Brak wyników.'
                  : `${library.size.toLocaleString('pl-PL')} symboli w aktywnych zestawach.`}
          </p>

          {hits.length > 0 && (
            <ul
              className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
              data-testid="library-results"
            >
              {hits.map((hit) => (
                <li key={`${hit.set}:${hit.id}`}>
                  <LibraryCard hit={hit} setName={library.setNames[hit.set]} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {library.usesArasaac && <p className="mt-4 text-xs text-slate-500">{ARASAAC_NOTE}</p>}
    </section>
  );
}

function LibraryCard({ hit, setName }: { hit: SymbolHit; setName: string }) {
  return (
    <div
      className={`flex h-full flex-col items-center rounded-xl border-4 bg-white p-2 ${ROLE_COLORS[hit.role].border}`}
    >
      <img
        src={hit.src}
        alt=""
        width={96}
        height={96}
        loading="lazy"
        decoding="async"
        className="size-24 object-contain"
      />
      <span className="mt-1 text-center text-sm font-semibold leading-tight text-slate-800">
        {hit.label}
      </span>
      <span className="text-xs text-slate-500">{setName}</span>
    </div>
  );
}
