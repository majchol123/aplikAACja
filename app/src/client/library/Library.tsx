import {
  type FitzgeraldRole,
  type LibrarySet,
  type Me,
  type Settings,
  type SymbolHit,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { buildSearch, useManifest, useSymbolSet } from './data.ts';

/** Fitzgerald Key colours (PLAN §3.3), used as the tile border. */
const ROLE_BORDER: Record<FitzgeraldRole, string> = {
  person: 'border-yellow-400',
  noun: 'border-orange-400',
  verb: 'border-green-500',
  descriptor: 'border-sky-500',
  social: 'border-pink-400',
  question: 'border-purple-500',
  negation: 'border-red-500',
  misc: 'border-slate-300',
};

const ARASAAC_NOTE =
  'Piktogramy: Sergio Palao, ARASAAC (arasaac.org), licencja CC BY-NC-SA, własność Rządu Aragonii.';

function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
}

export function Library({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const inputId = useId();

  // Shown immediately while the PATCH is in flight (a controlled checkbox must change
  // within the click event); cleared when the server answers.
  const [pendingSets, setPendingSets] = useState<Settings['activeSets'] | null>(null);
  const saved = settings.data?.activeSets;
  const active = useMemo(() => pendingSets ?? saved ?? [], [pendingSets, saved]);
  const wantsExtra = me.extraSet && active.includes('extra');
  const wantsArasaac = active.includes('arasaac');
  const arasaacManifest = useManifest('arasaac', wantsArasaac);
  // The small manifest is fetched whenever the set is granted, so its name can be shown.
  const extraManifest = useManifest('extra', me.extraSet);
  const arasaac = useSymbolSet(arasaacManifest.data, wantsArasaac);
  const extra = useSymbolSet(extraManifest.data, wantsExtra);

  const updateSets = useMutation({
    mutationFn: (activeSets: Settings['activeSets']) =>
      api<Settings>('/api/settings', { method: 'PATCH', json: { activeSets } }),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
    onSettled: () => setPendingSets(null),
  });

  const search = useMemo(
    () =>
      buildSearch([wantsArasaac ? arasaac.data : undefined, wantsExtra ? extra.data : undefined]),
    [arasaac.data, extra.data, wantsArasaac, wantsExtra],
  );

  const hits: SymbolHit[] = useMemo(() => {
    if (!settings.data) return [];
    const sets = active.filter(
      (s): s is LibrarySet => s === 'arasaac' || (s === 'extra' && me.extraSet),
    );
    return search.search(deferredQuery, {
      sets,
      hideSexual: settings.data.contentFilter.hideSexual,
      hideViolence: settings.data.contentFilter.hideViolence,
      limit: 60,
    });
  }, [search, deferredQuery, settings.data, active, me.extraSet]);

  const setNames: Record<LibrarySet, string> = {
    arasaac: 'ARASAAC',
    extra: extraManifest.data?.name ?? 'Dodatkowy zestaw',
  };
  const loading = (wantsArasaac && arasaac.isPending) || (wantsExtra && extra.isPending);
  const failed = [
    wantsArasaac && (arasaacManifest.isError || arasaac.isError) && 'ARASAAC',
    wantsExtra && (extraManifest.isError || extra.isError) && setNames.extra,
  ].filter(Boolean);

  function toggle(set: LibrarySet, on: boolean): void {
    if (!settings.data) return;
    const next = on ? [...active.filter((s) => s !== set), set] : active.filter((s) => s !== set);
    if (next.length === 0) return;
    setPendingSets(next);
    updateSets.mutate(next);
  }

  const offered: LibrarySet[] = me.extraSet ? ['arasaac', 'extra'] : ['arasaac'];

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
            {setNames[set]}
          </label>
        ))}
      </fieldset>

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
        {failed.length
          ? `Nie udało się wczytać: ${failed.join(', ')}.`
          : loading
            ? 'Wczytywanie biblioteki…'
            : deferredQuery.trim()
              ? hits.length
                ? `Znaleziono: ${hits.length}${hits.length === 60 ? '+' : ''}`
                : 'Brak wyników.'
              : `${search.size.toLocaleString('pl-PL')} symboli w aktywnych zestawach.`}
      </p>

      {hits.length > 0 && (
        <ul
          className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3"
          data-testid="library-results"
        >
          {hits.map((hit) => (
            <li
              key={`${hit.set}:${hit.id}`}
              className={`flex flex-col items-center rounded-xl border-4 bg-white p-2 ${ROLE_BORDER[hit.role]}`}
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
              <span className="text-xs text-slate-500">{setNames[hit.set]}</span>
            </li>
          ))}
        </ul>
      )}

      {wantsArasaac && <p className="mt-4 text-xs text-slate-500">{ARASAAC_NOTE}</p>}
    </section>
  );
}
