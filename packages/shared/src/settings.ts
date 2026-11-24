import { z } from 'zod';
import { LABEL_POSITIONS } from './boards.ts';
import { GRAMMAR_LEVELS, SPEAKER_GENDERS } from './inflect.ts';
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
    /**
     * Labels above or below the pictures, for every tile without a place of its own
     * (Tile.labelPosition null).
     */
    labelPosition: z.enum(LABEL_POSITIONS),
    /**
     * The folder "Wszystkie symbole" in the first cell of the home board: the category
     * folders of the active sets (F3). On by default; off leaves that cell empty.
     */
    showAllSymbols: z.boolean(),
    /**
     * Communication mode offers the phrase generator (F5; on by default). Settings are merged
     * with these defaults per key, so accounts that never switched it see it too.
     */
    showPhraseGenerator: z.boolean(),
    /**
     * Inflecting the sentence bar (F8, PLAN §2.10): off — words as on the tiles; verbs — the
     * verb agrees with the subject, "ja" by default ("iść" → "idę"). On by default.
     */
    grammar: z.enum(GRAMMAR_LEVELS),
    /** How the user speaks of themselves ("szedłem" / "szłam"); null: masculine forms. */
    speakerGender: z.enum(SPEAKER_GENDERS).nullable(),
    /** The last utterances are saved on the account (on by default; off clears them). */
    keepHistory: z.boolean(),
    /**
     * Daily counts of spoken phrases and tapped tiles go to the server for the admin panel
     * (statistics v2, usage.ts; on by default — legitimate interest with an opt-out). Off
     * deletes the counts collected so far; the Worker keeps a copy in users.usage_stats.
     */
    usageStats: z.boolean(),
    /** Last privacy-policy change the account was told about (POLICY_VERSION). */
    policyNotice: z.number().int().min(0).max(1000),
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
  labelPosition: 'top',
  showAllSymbols: true,
  showPhraseGenerator: true,
  grammar: 'verbs',
  speakerGender: null,
  keepHistory: true,
  usageStats: true,
  policyNotice: 0,
};

/**
 * Version of the privacy policy's last notable change, announced once in the app (the
 * policy promises it). 1: the history of utterances is saved on the account (2026-11-23).
 * 2: encrypted backups (2026-11-23). Usage counters and deleting the own account
 * (2026-11-24) are not announced: nobody used the app in production yet, so no account
 * was there under the older text.
 */
export const POLICY_VERSION = 2;
