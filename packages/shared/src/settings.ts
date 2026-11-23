import { z } from 'zod';
import { VOICE_PRESETS } from './speech.ts';

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
    /**
     * Voice preset and slider multipliers (PLAN §2.4): the user's own voice, so per account.
     * Which system voice plays each preset is chosen per device (device.ts).
     */
    speech: z
      .object({
        preset: z.enum(VOICE_PRESETS),
        rate: z.number().min(0.5).max(1.5),
        pitch: z.number().min(0.5).max(1.5),
      })
      .strict(),
    uppercaseLabels: z.boolean(),
    /** Communication mode offers the category folders of the sets (F3; off by default). */
    showAllSymbols: z.boolean(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = SettingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  activeSets: ['arasaac', 'own'],
  returnToHome: true,
  searchSources: 'both',
  // Violence stays visible by default: "hit", "bite", "kick" are everyday words for talking
  // about behaviour and for disclosing harm (PLAN §3.3).
  contentFilter: { hideSexual: true, hideViolence: false },
  speech: { preset: 'woman', rate: 1, pitch: 1 },
  uppercaseLabels: false,
  showAllSymbols: false,
};
