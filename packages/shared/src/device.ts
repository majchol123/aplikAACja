import { z } from 'zod';

/*
 * Settings of one device (tablet, phone), kept in its localStorage: system voices and touch
 * behaviour differ between devices of the same account (PLAN §2.4, §2.5). Account-wide
 * settings live in the vault (settings.ts).
 */

/** Minimum hold choices (PLAN §2.5); 0 = off. */
export const MIN_HOLD_STEPS = [0, 150, 300, 500, 800, 1200] as const;

export const MotorSettingsSchema = z
  .object({
    /** Activate when the finger lifts (default; moving > 12 px off the tile cancels) or on touch. */
    activateOn: z.enum(['release', 'press']),
    /** Shorter touches are ignored (release mode only); 0 = off. */
    minHoldMs: z.union(MIN_HOLD_STEPS.map((n) => z.literal(n))),
    /** The same tile again sooner than this is ignored. */
    sameTileGuardMs: z.number().int().min(0).max(2000),
    /** Any tile sooner than this after an activation is ignored (accidental multiple touches). */
    globalGuardMs: z.number().int().min(0).max(1000),
  })
  .strict();
export type MotorSettings = z.infer<typeof MotorSettingsSchema>;

const voiceURI = z.string().max(500).nullable();

export const DeviceSettingsSchema = z
  .object({
    /** System voice pinned for each preset on this device (names differ between platforms). */
    voices: z
      .object({ woman: voiceURI, man: voiceURI, girl: voiceURI, boy: voiceURI })
      .partial()
      .strict(),
    /** Speak each word when its tile is touched (the sentence is spoken with ▶). */
    speakOnTap: z.boolean(),
    /** Highlight the tile for 150 ms and vibrate for 20 ms (where supported) on activation. */
    feedback: z.boolean(),
    motor: MotorSettingsSchema,
    /**
     * Optional 4-digit PIN in front of edit mode on this device (PLAN §2.2), as salted
     * SHA-256. A lock against accidental edits, not a secret: 10 000 PINs are trivial to try.
     */
    pin: z
      .object({
        salt: z.string().regex(/^[0-9a-f]{32}$/),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict()
      .nullable(),
    /**
     * Fit board grids to the screen's orientation (grid.ts); null = not chosen: on for phones
     * (where small tiles hurt most and the orientation rarely changes), off elsewhere.
     */
    fitGrid: z.boolean().nullable(),
  })
  .strict();
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  voices: {},
  speakOnTap: true,
  feedback: true,
  motor: { activateOn: 'release', minHoldMs: 0, sameTileGuardMs: 400, globalGuardMs: 150 },
  pin: null,
  fitGrid: null,
};

/** Stored values from older versions fall back to defaults key by key. */
export function parseDeviceSettings(raw: unknown): DeviceSettings {
  const out = JSON.parse(JSON.stringify(DEFAULT_DEVICE_SETTINGS)) as Record<string, unknown>;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in out)) continue;
      const candidate = DeviceSettingsSchema.safeParse({ ...out, [key]: value });
      if (candidate.success) out[key] = value;
    }
  }
  return DeviceSettingsSchema.parse(out);
}
