import { parseDeviceSettings, type DeviceSettings } from '@relaacja/shared';
import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'relaacja.device.v1';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: DeviceSettings } | null = null;

function read(): DeviceSettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage disabled (private mode): defaults for this session.
  }
  if (!cache || cache.raw !== raw) {
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    cache = { raw, value: parseDeviceSettings(parsed) };
  }
  return cache.value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function saveDeviceSettings(value: DeviceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    cache = { raw: null, value };
  }
  for (const listener of listeners) listener();
}

/** Settings of this device (voice, touch), shared by every tab on it. */
export function useDeviceSettings(): [DeviceSettings, (patch: Partial<DeviceSettings>) => void] {
  const value = useSyncExternalStore(subscribe, read);
  const update = useCallback(
    (patch: Partial<DeviceSettings>) => saveDeviceSettings({ ...read(), ...patch }),
    [],
  );
  return [value, update];
}
