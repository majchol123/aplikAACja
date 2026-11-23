import {
  CategoryFileSchema,
  CategoryTree,
  LexiconSchema,
  SET_BASE,
  SetManifestSchema,
  SymbolIndexSchema,
  SymbolSearch,
  type LibrarySet,
  type Lexicon,
  type SetManifest,
  type SymbolIndex,
} from '@aplikaacja/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { z } from 'zod';

export interface LoadedSet {
  manifest: SetManifest;
  index: SymbolIndex;
  lexicon: Lexicon | null;
}

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return schema.parse(await res.json());
}

/** manifest.json is revalidated on every load; index and lexicon are immutable files. */
export async function loadManifest(set: LibrarySet): Promise<SetManifest> {
  const manifest = await getJson(`${SET_BASE[set]}manifest.json`, SetManifestSchema);
  if (manifest.set !== set) throw new Error(`manifest for ${set} describes ${manifest.set}`);
  return manifest;
}

async function loadIndex(manifest: SetManifest): Promise<SymbolIndex> {
  const index = await getJson(SET_BASE[manifest.set] + manifest.index, SymbolIndexSchema);
  if (index.set !== manifest.set)
    throw new Error(`index for ${manifest.set} describes ${index.set}`);
  return index;
}

export function useManifest(set: LibrarySet, enabled: boolean) {
  return useQuery({
    queryKey: ['symbol-manifest', set],
    queryFn: () => loadManifest(set),
    enabled,
    staleTime: Infinity,
    retry: 1,
  });
}

/** The index alone is enough to show tiles; keyed by its content-addressed name. */
export function useSymbolIndex(manifest: SetManifest | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['symbol-index', manifest?.set, manifest?.index],
    queryFn: () => (manifest ? loadIndex(manifest) : Promise.reject(new Error('no manifest'))),
    enabled: enabled && manifest !== undefined,
    staleTime: Infinity,
    retry: 1,
  });
}

/** Index + lexicon (search needs the inflected forms too). */
export function useSymbolSet(manifest: SetManifest | undefined, enabled: boolean) {
  const index = useSymbolIndex(manifest, enabled);
  const forms = useQuery({
    queryKey: ['symbol-forms', manifest?.set, manifest?.forms],
    queryFn: () =>
      manifest?.forms
        ? getJson(SET_BASE[manifest.set] + manifest.forms, LexiconSchema)
        : Promise.resolve(null),
    enabled: enabled && manifest !== undefined,
    staleTime: Infinity,
    retry: 1,
  });
  // Stable identity: the search index built from it is expensive.
  const data = useMemo<LoadedSet | undefined>(
    () =>
      manifest && index.data && forms.data !== undefined
        ? { manifest, index: index.data, lexicon: forms.data }
        : undefined,
    [manifest, index.data, forms.data],
  );
  return {
    data,
    isPending: index.isPending || forms.isPending,
    isError: index.isError || forms.isError,
  };
}

/**
 * Index + category tree of a set (F2 step 6). `tree` is null for a set built without
 * categories and while loading; `isError` covers a tree the client cannot trust.
 */
export function useCategoryTree(manifest: SetManifest | undefined, enabled: boolean) {
  const index = useSymbolIndex(manifest, enabled);
  const file = useQuery({
    queryKey: ['symbol-categories', manifest?.set, manifest?.categories],
    queryFn: () =>
      manifest?.categories
        ? getJson(SET_BASE[manifest.set] + manifest.categories, CategoryFileSchema)
        : Promise.resolve(null),
    enabled: enabled && manifest !== undefined,
    staleTime: Infinity,
    retry: 1,
  });
  const built = useMemo(() => {
    if (!index.data || !file.data) return { tree: null, broken: false };
    try {
      return { tree: new CategoryTree(file.data, index.data), broken: false };
    } catch (err) {
      console.warn('category tree rejected', err);
      return { tree: null, broken: true };
    }
  }, [index.data, file.data]);
  return {
    tree: built.tree,
    /** The set has no category tree (built before F2 step 6). */
    missing: file.data === null,
    isPending: index.isPending || file.isPending,
    isError: index.isError || file.isError || built.broken,
  };
}

export function buildSearch(sets: (LoadedSet | undefined)[]): SymbolSearch {
  const loaded = sets.filter((s): s is LoadedSet => s !== undefined);
  return new SymbolSearch(
    loaded.map((s) => s.index),
    loaded.flatMap((s) => (s.lexicon ? [s.lexicon] : [])),
  );
}
