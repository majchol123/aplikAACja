import type { DeviceSettings } from '@relaacja/shared';

export type StoredPin = NonNullable<DeviceSettings['pin']>;

export const PIN_LENGTH = 4;
export const isPin = (value: string) => /^[0-9]{4}$/.test(value);

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Salted SHA-256 of the PIN: keeps it from being read off the device in plain text. */
export async function hashPin(pin: string, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return { salt, hash: hex(new Uint8Array(digest)) } satisfies StoredPin;
}

export async function checkPin(pin: string, stored: StoredPin): Promise<boolean> {
  return (await hashPin(pin, stored.salt)).hash === stored.hash;
}
