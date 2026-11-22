import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_SETTINGS, parseDeviceSettings, type MotorSettings } from './device.ts';
import { TapFilter } from './tap.ts';

const release: MotorSettings = {
  activateOn: 'release',
  minHoldMs: 0,
  sameTileGuardMs: 400,
  globalGuardMs: 150,
};

describe('TapFilter', () => {
  it('activates on lift over the same tile only', () => {
    const f = new TapFilter(release);
    expect(f.down(1, 'a', 0)).toBeNull();
    expect(f.up(1, 'a', 80)).toBe('a');
    // Slid from a to b: nothing.
    f.down(1, 'a', 1000);
    expect(f.up(1, 'b', 1100)).toBeNull();
    // Lifted outside any tile.
    f.down(1, 'a', 2000);
    expect(f.up(1, null, 2100)).toBeNull();
  });

  it('drops a second activation within the global and same-tile windows', () => {
    const f = new TapFilter(release);
    f.down(1, 'a', 0);
    expect(f.up(1, 'a', 50)).toBe('a');
    // Any tile within 150 ms.
    f.down(2, 'b', 100);
    expect(f.up(2, 'b', 120)).toBeNull();
    // Another tile after 150 ms is fine…
    f.down(3, 'b', 250);
    expect(f.up(3, 'b', 260)).toBe('b');
    // …the same tile needs 400 ms since its own last activation.
    f.down(4, 'b', 500);
    expect(f.up(4, 'b', 550)).toBeNull();
    f.down(5, 'b', 700);
    expect(f.up(5, 'b', 720)).toBe('b');
  });

  it('requires the minimum hold', () => {
    const f = new TapFilter({ ...release, minHoldMs: 500 });
    f.down(1, 'a', 0);
    expect(f.up(1, 'a', 300)).toBeNull();
    f.down(1, 'a', 1000);
    expect(f.up(1, 'a', 1600)).toBe('a');
  });

  it('ignores multi-finger touches until every finger is lifted', () => {
    const f = new TapFilter(release);
    f.down(1, 'a', 0);
    f.down(2, 'b', 10);
    expect(f.up(1, 'a', 50)).toBeNull();
    // Finger 2 still down: a new touch does not start a gesture.
    expect(f.down(3, 'c', 60)).toBeNull();
    expect(f.up(3, 'c', 100)).toBeNull();
    expect(f.up(2, 'b', 120)).toBeNull();
    f.down(4, 'c', 1000);
    expect(f.up(4, 'c', 1050)).toBe('c');
  });

  it('activates on touch in press mode and forgets cancelled pointers', () => {
    const f = new TapFilter({ ...release, activateOn: 'press' });
    expect(f.down(1, 'a', 0)).toBe('a');
    expect(f.up(1, 'a', 50)).toBeNull();
    const g = new TapFilter(release);
    g.down(1, 'a', 0);
    g.cancel(1);
    expect(g.up(1, 'a', 50)).toBeNull();
    g.down(2, 'a', 100);
    expect(g.up(2, 'a', 150)).toBe('a');
  });
});

describe('device settings', () => {
  it('falls back to defaults key by key', () => {
    expect(parseDeviceSettings(null)).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(
      parseDeviceSettings({ speakOnTap: false, motor: { activateOn: 'sideways' }, extra: 1 }),
    ).toEqual({
      ...DEFAULT_DEVICE_SETTINGS,
      speakOnTap: false,
    });
  });
});
