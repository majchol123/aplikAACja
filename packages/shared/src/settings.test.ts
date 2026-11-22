import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsPatchSchema, SettingsSchema } from './settings.ts';

describe('SettingsSchema', () => {
  it('accepts defaults', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects unknown keys and duplicate sets', () => {
    expect(SettingsPatchSchema.safeParse({ evil: 1 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ activeSets: ['own', 'own'] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ activeSets: [] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ activeSets: ['pcs'] }).success).toBe(false);
  });

  it('accepts a partial patch', () => {
    expect(SettingsPatchSchema.parse({ returnToHome: false })).toEqual({ returnToHome: false });
  });
});
