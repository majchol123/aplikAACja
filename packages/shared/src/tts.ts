import { z } from 'zod';
import { type SpeechPrefs, type VoicePreset } from './speech.ts';

/** Prefix for local Piper neural voices stored in device `localStorage` (`voices`). */
export const PIPER_VOICE_PREFIX = 'piper:';

const VOICE_ID_RE = /^[a-z]{2}_[A-Z]{2}-[a-z0-9_]+-(?:x_low|low|medium|high)$/;
const HASH8_RE = /^[0-9a-f]{8}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REL_FILE_RE = /^[A-Za-z0-9._/-]+$/;

export function piperVoiceURI(id: string): string {
  return `${PIPER_VOICE_PREFIX}${id}`;
}

export function isPiperVoiceURI(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && uri.startsWith(PIPER_VOICE_PREFIX);
}

export function piperVoiceIdFromURI(uri: string | null | undefined): string | null {
  if (!isPiperVoiceURI(uri)) return null;
  const id = uri.slice(PIPER_VOICE_PREFIX.length);
  return VOICE_ID_RE.test(id) ? id : null;
}

export const TtsRuntimeSchema = z
  .object({
    hash: z.string().regex(HASH8_RE),
    ortMjs: z.string().regex(REL_FILE_RE),
    ortWasm: z.string().regex(REL_FILE_RE),
    phonemizeWasm: z.string().regex(REL_FILE_RE),
    phonemizeData: z.string().regex(REL_FILE_RE),
    phonemizeWasmSha256: z.string().regex(SHA256_RE),
    phonemizeDataSha256: z.string().regex(SHA256_RE),
    totalBytes: z.number().int().positive(),
  })
  .strict();
export type TtsRuntime = z.infer<typeof TtsRuntimeSchema>;

export const TtsVoiceSchema = z
  .object({
    id: z.string().regex(VOICE_ID_RE),
    name: z.string().min(1).max(80),
    gender: z.enum(['female', 'male']),
    quality: z.enum(['x_low', 'low', 'medium', 'high']),
    sampleRate: z.number().int().positive(),
    license: z.string().min(1).max(40),
    sourceName: z.string().min(1).max(120),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(SHA256_RE),
    config: z.string().regex(REL_FILE_RE),
    parts: z.array(z.string().regex(REL_FILE_RE)).min(1).max(32),
  })
  .strict();
export type TtsVoice = z.infer<typeof TtsVoiceSchema>;

export const TtsManifestSchema = z
  .object({
    v: z.literal(1),
    runtime: TtsRuntimeSchema,
    voices: z.array(TtsVoiceSchema).min(1).max(32),
  })
  .strict();
export type TtsManifest = z.infer<typeof TtsManifestSchema>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const PIPER_PRESET_BASE: Record<VoicePreset, { rate: number; pitch: number }> = {
  woman: { rate: 0.95, pitch: 1 },
  man: { rate: 0.95, pitch: 1 },
  girl: { rate: 1.05, pitch: 1.2 },
  boy: { rate: 1.05, pitch: 1.15 },
};

/**
 * Computes Piper VITS `length_scale` multiplier and Web Audio `playbackRate` pitch shift.
 * Multiplying `length_scale` by `pitchFactor` keeps perceived speaking rate unchanged when
 * `AudioBufferSourceNode.playbackRate` shifts pitch.
 */
export function piperSpeechParams(
  prefs: Pick<SpeechPrefs, 'preset' | 'rate' | 'pitch'>,
  baseLengthScale = 1,
): { lengthScale: number; pitchFactor: number } {
  const base = PIPER_PRESET_BASE[prefs.preset];
  const rate = clamp(base.rate * clamp(prefs.rate, 0.5, 1.5), 0.5, 1.8);
  const pitchFactor = clamp(base.pitch * clamp(prefs.pitch, 0.5, 1.5), 0.75, 1.35);
  const lengthScale = (baseLengthScale / rate) * pitchFactor;
  return { lengthScale, pitchFactor };
}

export interface PiperModelConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_id_map: Record<string, number[]>;
  speaker_id_map?: Record<string, number>;
}

const SENTENCE_END = new Set(['.', '!', '?']);

/**
 * Maps IPA phonemes emitted by `piper_phonemize` to model input IDs using the voice's own
 * `phoneme_id_map` (BOS `^`, inter-phoneme pad `_`, EOS `$`). Unknown symbols are skipped so
 * rare characters never break speech.
 */
export function phonemesToIds(
  phonemes: readonly string[],
  idMap: Readonly<Record<string, readonly number[]>>,
): number[] {
  if (phonemes.length === 0) return [];
  const bos = idMap['^'] ?? [1];
  const pad = idMap['_'] ?? [0];
  const eos = idMap['$'] ?? [2];
  const ids: number[] = [];

  const startSentence = () => {
    ids.push(...bos, ...pad);
  };
  const endSentence = () => {
    ids.push(...eos);
  };

  let inSentence = false;
  for (const ph of phonemes) {
    const mapped = idMap[ph];
    if (!mapped) continue;
    if (!inSentence) {
      startSentence();
      inSentence = true;
    }
    ids.push(...mapped, ...pad);
    if (SENTENCE_END.has(ph)) {
      endSentence();
      inSentence = false;
    }
  }
  if (inSentence) endSentence();
  return ids;
}
