import { z } from 'zod';

/**
 * `extra` is an optional additional symbol set granted per account by an administrator
 * (users.extra_set_enabled). Its assets are not part of this repository.
 */
export const SYMBOL_SETS = ['arasaac', 'extra', 'own'] as const;
export const SymbolSetSchema = z.enum(SYMBOL_SETS);
export type SymbolSet = z.infer<typeof SymbolSetSchema>;

/**
 * Account-wide settings stored in the user's Durable Object.
 * Device-specific settings (voice assignment, motor tuning) live in the browser.
 */
export const SettingsSchema = z
  .object({
    activeSets: z
      .array(SymbolSetSchema)
      .min(1)
      .max(SYMBOL_SETS.length)
      .refine((sets) => new Set(sets).size === sets.length, 'duplicate symbol set'),
    returnToHome: z.boolean(),
    searchSources: z.enum(['tiles', 'library', 'both']),
    contentFilter: z
      .object({
        hideSexual: z.boolean(),
        hideViolence: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  activeSets: ['arasaac', 'own'],
  returnToHome: true,
  searchSources: 'both',
  contentFilter: { hideSexual: true, hideViolence: true },
};
