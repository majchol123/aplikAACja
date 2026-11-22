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
  c: z.string().max(100).optional(),
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

/** Normalized lemma → normalized inflected forms (PoliMorf, PLAN D10). */
export const LexiconSchema = z.object({
  v: z.literal(1),
  lemmas: z.record(z.string(), z.array(z.string())),
});
export type Lexicon = z.infer<typeof LexiconSchema>;
