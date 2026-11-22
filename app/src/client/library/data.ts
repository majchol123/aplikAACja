import {
  LexiconSchema,
  SET_BASE,
  SetManifestSchema,
  SymbolIndexSchema,
  SymbolSearch,
  type LibrarySet,
  type Lexicon,
  type SetManifest,
  type SymbolIndex,
} from '@relaacja/shared';
import { useQuery } from '@tanstack/react-query';
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

export async function loadSet(manifest: SetManifest): Promise<LoadedSet> {
  const base = SET_BASE[manifest.set];
  const [index, lexicon] = await Promise.all([
    getJson(base + manifest.index, SymbolIndexSchema),
    manifest.forms ? getJson(base + manifest.forms, LexiconSchema) : Promise.resolve(null),
  ]);
  if (index.set !== manifest.set)
    throw new Error(`index for ${manifest.set} describes ${index.set}`);
  return { manifest, index, lexicon };
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

/** Index + lexicon, keyed by their content-addressed names. */
export function useSymbolSet(manifest: SetManifest | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['symbol-set', manifest?.set, manifest?.index, manifest?.forms],
    queryFn: () => (manifest ? loadSet(manifest) : Promise.reject(new Error('no manifest'))),
    enabled: enabled && manifest !== undefined,
    staleTime: Infinity,
    retry: 1,
  });
}

export function buildSearch(sets: (LoadedSet | undefined)[]): SymbolSearch {
  const loaded = sets.filter((s): s is LoadedSet => s !== undefined);
  return new SymbolSearch(
    loaded.map((s) => s.index),
    loaded.flatMap((s) => (s.lexicon ? [s.lexicon] : [])),
  );
}
