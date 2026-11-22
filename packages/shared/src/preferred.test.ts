import { describe, expect, it } from 'vitest';
import { parseDeviceSettings } from './device.ts';
import { preferredKey, PutPreferredSchema } from './preferred.ts';

describe('preferred variants', () => {
  it('keys words like the search does: case, diacritics and spacing ignored', () => {
    expect(preferredKey('Jabłko')).toBe('jablko');
    expect(preferredKey('  dzień   dobry ')).toBe('dzien dobry');
    expect(preferredKey('co?')).toBe('co');
  });

  it('refuses words without letters or digits and foreign symbol refs', () => {
    const ok = { word: 'nos', symbol: { set: 'arasaac', ref: '2727' } };
    expect(PutPreferredSchema.safeParse(ok).success).toBe(true);
    expect(PutPreferredSchema.safeParse({ ...ok, word: '?!' }).success).toBe(false);
    expect(
      PutPreferredSchema.safeParse({ ...ok, symbol: { set: 'arasaac', ref: 'x' } }).success,
    ).toBe(false);
  });
});

describe('device PIN', () => {
  it('is off by default and a malformed stored PIN falls back to off', () => {
    expect(parseDeviceSettings(null).pin).toBeNull();
    expect(parseDeviceSettings({ pin: { salt: 'x', hash: 'y' } }).pin).toBeNull();
    const pin = { salt: 'a'.repeat(32), hash: 'b'.repeat(64) };
    expect(parseDeviceSettings({ pin }).pin).toEqual(pin);
  });
});
