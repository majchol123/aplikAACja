import {
  CategoryIconsSchema,
  type CategoryIcons,
  type PutCategoryIcon,
  type CategoryTree,
  type FolderIcons,
  type LibrarySet,
  type Me,
  type Settings,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api.ts';
import { useAccountSettings } from '../settings/account.ts';
import { useCategoryTree, useManifest } from './data.ts';

const NO_SETS: Settings['activeSets'] = [];

export interface BrowsableSet {
  set: LibrarySet;
  name: string;
  tree: CategoryTree;
  /** Folder pictures chosen by admins. */
  icons: FolderIcons;
}

export const CATEGORY_ICONS_KEY = ['category-icons'] as const;

/** Admins' folder pictures (shared by all accounts); rarely change, so cached for a while. */
export function useCategoryIcons() {
  return useQuery({
    queryKey: CATEGORY_ICONS_KEY,
    queryFn: async () =>
      CategoryIconsSchema.parse(await api<CategoryIcons>('/api/symbols/category-icons')),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

/** Admin only: sets (symbol) or resets (null) a folder picture for every account. */
export function useSetFolderIcon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PutCategoryIcon) =>
      CategoryIconsSchema.parse(
        await api<CategoryIcons>('/api/admin/category-icons', { method: 'PUT', json: input }),
      ),
    onSuccess: (icons) => queryClient.setQueryData(CATEGORY_ICONS_KEY, icons),
  });
}

const toMap = (icons: Record<string, number> | undefined): FolderIcons =>
  new Map(Object.entries(icons ?? {}));

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
  // A failure only costs the admins' pictures: the automatic ones are shown.
  const chosen = useCategoryIcons();
  const icons = useMemo<Record<LibrarySet, FolderIcons>>(
    () => ({ arasaac: toMap(chosen.data?.arasaac), extra: toMap(chosen.data?.extra) }),
    [chosen.data],
  );

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
    return data.tree ? [{ set, name, tree: data.tree, icons: icons[set] }] : [];
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
