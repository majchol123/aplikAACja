import type { LibrarySet, Me, Settings, SymbolHit } from '@relaacja/shared';
import { useCallback, useMemo } from 'react';
import { useAccountSettings } from '../settings/account.ts';
import { buildSearch, useManifest, useSymbolSet } from './data.ts';

const NO_SETS: Settings['activeSets'] = [];

/**
 * Search over the account's active library sets (PLAN §2.2, §3.3). `active` overrides the
 * saved choice while a change of it is being saved.
 */
export function useLibrary(me: Me, active?: Settings['activeSets']) {
  const settings = useAccountSettings();
  const sets = active ?? settings.data?.activeSets ?? NO_SETS;
  const wantsArasaac = sets.includes('arasaac');
  const wantsExtra = me.extraSet && sets.includes('extra');
  const arasaacManifest = useManifest('arasaac', wantsArasaac);
  // The small manifest is fetched whenever the set is granted, so its name can be shown.
  const extraManifest = useManifest('extra', me.extraSet);
  const arasaac = useSymbolSet(arasaacManifest.data, wantsArasaac);
  const extra = useSymbolSet(extraManifest.data, wantsExtra);

  const index = useMemo(
    () =>
      buildSearch([wantsArasaac ? arasaac.data : undefined, wantsExtra ? extra.data : undefined]),
    [arasaac.data, extra.data, wantsArasaac, wantsExtra],
  );
  const filter = settings.data?.contentFilter;
  const librarySets = useMemo(
    () => sets.filter((s): s is LibrarySet => s === 'arasaac' || (s === 'extra' && me.extraSet)),
    [sets, me.extraSet],
  );

  const search = useCallback(
    (query: string, limit = 60): SymbolHit[] =>
      filter
        ? index.search(query, {
            sets: librarySets,
            hideSexual: filter.hideSexual,
            hideViolence: filter.hideViolence,
            limit,
          })
        : [],
    [index, filter, librarySets],
  );

  const extraName = extraManifest.data?.name ?? 'Dodatkowy zestaw';
  const setNames = useMemo<Record<LibrarySet, string>>(
    () => ({ arasaac: 'ARASAAC', extra: extraName }),
    [extraName],
  );
  const failed = [
    wantsArasaac && (arasaacManifest.isError || arasaac.isError) && setNames.arasaac,
    wantsExtra && (extraManifest.isError || extra.isError) && setNames.extra,
  ].filter((name): name is string => typeof name === 'string');

  return {
    search,
    size: index.size,
    sets,
    setNames,
    usesArasaac: wantsArasaac,
    loading: (wantsArasaac && arasaac.isPending) || (wantsExtra && extra.isPending),
    failed,
    ready: settings.data !== undefined,
  };
}
