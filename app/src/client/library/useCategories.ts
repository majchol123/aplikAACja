import type { CategoryTree, LibrarySet, Me, Settings } from '@relaacja/shared';
import { useAccountSettings } from '../settings/account.ts';
import { useCategoryTree, useManifest } from './data.ts';

const NO_SETS: Settings['activeSets'] = [];

export interface BrowsableSet {
  set: LibrarySet;
  name: string;
  tree: CategoryTree;
}

/**
 * Category trees of the account's active sets, in the order of the search results
 * (PLAN §3.3). The extra set exists only for accounts granted it: without the flag its
 * files are never requested. `active` overrides the saved choice while it is being saved.
 */
export function useCategories(me: Me, active?: Settings['activeSets']) {
  const settings = useAccountSettings();
  const sets = active ?? settings.data?.activeSets ?? NO_SETS;
  const wantsArasaac = sets.includes('arasaac');
  const wantsExtra = me.extraSet && sets.includes('extra');
  // Same queries as the search: the manifests and indexes are fetched once.
  const arasaacManifest = useManifest('arasaac', wantsArasaac);
  const extraManifest = useManifest('extra', me.extraSet);
  const arasaac = useCategoryTree(arasaacManifest.data, wantsArasaac);
  const extra = useCategoryTree(extraManifest.data, wantsExtra);

  const byName = {
    arasaac: { wanted: wantsArasaac, name: 'ARASAAC', manifest: arasaacManifest, data: arasaac },
    extra: {
      wanted: wantsExtra,
      name: extraManifest.data?.name ?? 'Dodatkowy zestaw',
      manifest: extraManifest,
      data: extra,
    },
  } as const;
  const wanted = sets.filter(
    (s): s is LibrarySet => (s === 'arasaac' || s === 'extra') && byName[s].wanted,
  );

  const browsable: BrowsableSet[] = wanted.flatMap((set) => {
    const { name, data } = byName[set];
    return data.tree ? [{ set, name, tree: data.tree }] : [];
  });
  const failed = wanted
    .filter((set) => byName[set].manifest.isError || byName[set].data.isError)
    .map((set) => byName[set].name);
  const loading = wanted.some(
    (set) =>
      byName[set].manifest.isPending || (byName[set].data.isPending && !byName[set].data.missing),
  );

  return {
    sets: browsable,
    filter: settings.data?.contentFilter,
    loading,
    failed,
    /** No active set has categories yet (sets built before F2 step 6). */
    none: !loading && failed.length === 0 && browsable.length === 0,
  };
}
