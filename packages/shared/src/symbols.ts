import { z } from 'zod';

/**
 * Symbol-set asset formats written by tools/relaacja_tools/symbolset.py (PLAN §3.3) and
 * served as static files under /sym/<set>/. Shared vectors: test-vectors/sample-*.json.
 */
export const LIBRARY_SETS = ['arasaac', 'extra'] as const;
export const LibrarySetSchema = z.enum(LIBRARY_SETS);
export type LibrarySet = z.infer<typeof LibrarySetSchema>;

/** Where each set lives; the extra set goes through the Worker's access gate. */
export const SET_BASE: Record<LibrarySet, string> = {
  arasaac: '/sym/arasaac/',
  extra: '/sym/extra/',
};

/** Fitzgerald Key word classes used for automatic tile colours. */
export const FITZGERALD_ROLES = [
  'person',
  'noun',
  'verb',
  'descriptor',
  'social',
  'question',
  'negation',
  'misc',
] as const;
export const FitzgeraldRoleSchema = z.enum(FITZGERALD_ROLES);
export type FitzgeraldRole = z.infer<typeof FitzgeraldRoleSchema>;

export const FLAG_AAC = 1;
export const FLAG_SEX = 2;
export const FLAG_VIOLENCE = 4;

const hashedJson = (stem: string) => new RegExp(`^${stem}\\.[0-9a-f]{8}\\.json$`);

export const SetManifestSchema = z.object({
  v: z.literal(1),
  set: LibrarySetSchema,
  name: z.string().min(1).max(100),
  index: z.string().regex(hashedJson('index')),
  forms: z.string().regex(hashedJson('forms')).optional(),
  /** Browsing tree (F2 step 6); sets built before it have none. */
  categories: z.string().regex(hashedJson('categories')).optional(),
  count: z.number().int().nonnegative(),
});
export type SetManifest = z.infer<typeof SetManifestSchema>;

export const SymbolItemSchema = z.object({
  id: z.number().int().nonnegative(),
  /** Image path relative to the set directory: content-addressed, cached forever. */
  f: z.string().regex(/^[px]\/[0-9]{1,10}\.[0-9a-f]{8}\.webp$/),
  k: z.array(z.string().min(1).max(200)).min(1).max(20),
  r: FitzgeraldRoleSchema,
  x: z.number().int().min(0).max(7).optional(),
  /** Ids of the category folders listing this symbol (categories.<hash>.json). */
  g: z.array(z.number().int().nonnegative()).max(20).optional(),
});
export type SymbolItem = z.infer<typeof SymbolItemSchema>;

export const SymbolIndexSchema = z.object({
  v: z.literal(1),
  set: LibrarySetSchema,
  name: z.string().min(1).max(100),
  attribution: z.string().max(1000).optional(),
  items: z.array(SymbolItemSchema).max(50_000),
});
export type SymbolIndex = z.infer<typeof SymbolIndexSchema>;

/** Stable folder key (ARASAAC category key, id of an extra-set category). */
export const CATEGORY_KEY = /^[a-z0-9][a-z0-9 _-]{0,99}$/;

export const CategoryNodeSchema = z.object({
  id: z.number().int().nonnegative(),
  n: z.string().min(1).max(100),
  /** Survives rebuilds of the set (ids may not): admins' folder pictures use it. */
  k: z.string().regex(CATEGORY_KEY).optional(),
  /** Parent folder; it always comes earlier in the file. */
  p: z.number().int().nonnegative().optional(),
  /** Folder picture: a symbol of the same set… */
  i: z.number().int().nonnegative().optional(),
  /** …or an own icon file. */
  f: z
    .string()
    .regex(/^g\/[0-9]{1,10}\.[0-9a-f]{8}\.webp$/)
    .optional(),
});
export type CategoryNode = z.infer<typeof CategoryNodeSchema>;

export const CategoryFileSchema = z.object({
  v: z.literal(1),
  set: LibrarySetSchema,
  nodes: z.array(CategoryNodeSchema).max(5000),
});
export type CategoryFile = z.infer<typeof CategoryFileSchema>;

const SymbolIdSchema = z.number().int().min(0).max(9_999_999_999);

/** Folder pictures chosen by admins: category key → symbol id of the same set. */
export const CategoryIconsSchema = z.object({
  arasaac: z.record(z.string().regex(CATEGORY_KEY), SymbolIdSchema),
  /** Only for accounts granted the extra set. */
  extra: z.record(z.string().regex(CATEGORY_KEY), SymbolIdSchema).optional(),
});
export type CategoryIcons = z.infer<typeof CategoryIconsSchema>;

/** PUT /api/admin/category-icons; `symbol: null` returns the folder to the automatic one. */
export const PutCategoryIconSchema = z
  .object({
    set: LibrarySetSchema,
    key: z.string().regex(CATEGORY_KEY),
    symbol: SymbolIdSchema.nullable(),
  })
  .strict();
export type PutCategoryIcon = z.infer<typeof PutCategoryIconSchema>;

/** The account's content filter (PLAN §3.3), applied to search and category browsing. */
export interface SymbolFilter {
  hideSexual: boolean;
  hideViolence: boolean;
}

export function isFiltered(flags: number, filter: SymbolFilter): boolean {
  return (
    (filter.hideSexual && (flags & FLAG_SEX) !== 0) ||
    (filter.hideViolence && (flags & FLAG_VIOLENCE) !== 0)
  );
}

/** Normalized lemma → normalized inflected forms (PoliMorf, PLAN D10). */
export const LexiconSchema = z.object({
  v: z.literal(1),
  lemmas: z.record(z.string(), z.array(z.string())),
});
export type Lexicon = z.infer<typeof LexiconSchema>;
