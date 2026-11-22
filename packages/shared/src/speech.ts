/**
 * Text-to-speech voice selection (PLAN §2, D7). Web Speech exposes no voice gender and no
 * child voices, so presets combine a guessed gender with pitch/rate; the parent can pin a
 * specific voice per device. Pure functions: the browser part lives in the client.
 */
export const VOICE_PRESETS = ['woman', 'man', 'girl', 'boy'] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

/** The subset of SpeechSynthesisVoice used here. */
export interface VoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export type Gender = 'female' | 'male';

export interface SpeechPrefs {
  preset: VoicePreset;
  /** Voice pinned for this preset on this device; null = pick automatically. */
  voiceURI: string | null;
  /** Account slider multipliers on top of the preset (0.5–1.5). */
  rate: number;
  pitch: number;
}

export interface SpeechPlan {
  voiceURI: string | null;
  lang: 'pl-PL';
  pitch: number;
  rate: number;
}

interface PresetShape {
  gender: Gender;
  pitch: number;
  rate: number;
  /** Pitch used when only a voice of the other gender is available. */
  otherGenderPitch: number;
}

/** PLAN §2.4 table; "otherGenderPitch" e.g. a boy on a device with only a female voice. */
const PRESETS: Record<VoicePreset, PresetShape> = {
  woman: { gender: 'female', pitch: 1, rate: 0.95, otherGenderPitch: 1.35 },
  man: { gender: 'male', pitch: 1, rate: 0.95, otherGenderPitch: 0.8 },
  girl: { gender: 'female', pitch: 1.6, rate: 1.05, otherGenderPitch: 1.9 },
  boy: { gender: 'male', pitch: 1.45, rate: 1.05, otherGenderPitch: 1.3 },
};

// Names of Polish voices shipped by Microsoft, Apple, Amazon and Google, plus generic words.
const FEMALE =
  /\b(paulina|zofia|agnieszka|maja|ewa|ola|zosia|natalia|anna|alicja|marta|female|kobieta)\b|^google polski/i;
const MALE = /\b(adam|marek|krzysztof|jacek|jan|tomasz|piotr|male|m[eę][zż]czyzna)\b/i;
const HIGH_QUALITY = /natural|neural|premium|enhanced|wavenet|online/i;

export function voiceGender(voice: VoiceInfo): Gender | null {
  if (FEMALE.test(voice.name)) return 'female';
  if (MALE.test(voice.name)) return 'male';
  return null;
}

/**
 * Polish voices, best first: offline-capable ones (an AAC device must keep talking without
 * network), then higher quality, then the platform default.
 */
export function polishVoices(voices: readonly VoiceInfo[]): VoiceInfo[] {
  const score = (v: VoiceInfo) =>
    (v.localService ? 4 : 0) + (HIGH_QUALITY.test(v.name) ? 2 : 0) + (v.default ? 1 : 0);
  return voices
    .filter((v) => /^pl([-_]|$)/i.test(v.lang))
    .map((v, i) => ({ v, i }))
    .sort((a, b) => score(b.v) - score(a.v) || a.i - b.i)
    .map(({ v }) => v);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function planSpeech(voices: readonly VoiceInfo[], prefs: SpeechPrefs): SpeechPlan {
  const preset = PRESETS[prefs.preset];
  const rate = clamp(preset.rate * clamp(prefs.rate, 0.5, 1.5), 0.3, 2);
  const plan = (voice: VoiceInfo | undefined, pitch: number): SpeechPlan => ({
    voiceURI: voice?.voiceURI ?? null,
    lang: 'pl-PL',
    pitch: clamp(pitch * clamp(prefs.pitch, 0.5, 1.5), 0, 2),
    rate,
  });

  const polish = polishVoices(voices);
  const pinned = prefs.voiceURI ? polish.find((v) => v.voiceURI === prefs.voiceURI) : undefined;
  if (pinned) return plan(pinned, preset.pitch);
  const sameGender = polish.find((v) => voiceGender(v) === preset.gender);
  if (sameGender) return plan(sameGender, preset.pitch);
  const best = polish[0];
  const gender = best ? voiceGender(best) : null;
  return plan(
    best,
    gender !== null && gender !== preset.gender ? preset.otherGenderPitch : preset.pitch,
  );
}
