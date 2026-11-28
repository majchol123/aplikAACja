import { describe, expect, it } from 'vitest';
import {
  isPiperVoiceURI,
  phonemesToIds,
  piperSpeechParams,
  piperVoiceIdFromURI,
  piperVoiceURI,
  TtsManifestSchema,
} from './tts.ts';

describe('Piper TTS helpers', () => {
  it('encodes and parses Piper voice URIs', () => {
    const uri = piperVoiceURI('pl_PL-gosia-medium');
    expect(uri).toBe('piper:pl_PL-gosia-medium');
    expect(isPiperVoiceURI(uri)).toBe(true);
    expect(piperVoiceIdFromURI(uri)).toBe('pl_PL-gosia-medium');
    expect(isPiperVoiceURI('Zosia')).toBe(false);
    expect(piperVoiceIdFromURI('Zosia')).toBeNull();
    expect(piperVoiceIdFromURI('piper:../evil')).toBeNull();
  });

  it('validates a /tts/manifest.json payload', () => {
    const parsed = TtsManifestSchema.parse({
      v: 1,
      runtime: {
        hash: 'a1b2c3d4',
        ortMjs: 'runtime/a1b2c3d4/ort-wasm-simd-threaded.mjs',
        ortWasm: 'runtime/a1b2c3d4/ort-wasm-simd-threaded.wasm',
        phonemizeWasm: 'runtime/a1b2c3d4/piper_phonemize.wasm',
        phonemizeData: 'runtime/a1b2c3d4/piper_phonemize.data',
        phonemizeWasmSha256: '0'.repeat(64),
        phonemizeDataSha256: '1'.repeat(64),
        totalBytes: 33_000_000,
      },
      voices: [
        {
          id: 'pl_PL-gosia-medium',
          name: 'Gosia',
          gender: 'female',
          quality: 'medium',
          sampleRate: 22050,
          license: 'CC0',
          sourceName: 'rhasspy/piper-voices',
          bytes: 63_221_984,
          sha256: 'a'.repeat(64),
          config: 'voices/pl_PL-gosia-medium.11223344.onnx.json',
          parts: [
            'voices/pl_PL-gosia-medium.11223344.onnx.part00',
            'voices/pl_PL-gosia-medium.11223344.onnx.part01',
          ],
        },
      ],
    });
    expect(parsed.voices[0]?.id).toBe('pl_PL-gosia-medium');
  });

  it('compensates lengthScale when pitchFactor shifts playbackRate', () => {
    const woman = piperSpeechParams({ preset: 'woman', rate: 1, pitch: 1 }, 1);
    expect(woman.pitchFactor).toBe(1);
    expect(woman.lengthScale).toBeCloseTo(1 / 0.95, 5);

    const girl = piperSpeechParams({ preset: 'girl', rate: 1, pitch: 1 }, 1);
    expect(girl.pitchFactor).toBeCloseTo(1.2, 5);
    expect(girl.lengthScale).toBeCloseTo((1 / 1.05) * 1.2, 5);

    const clamped = piperSpeechParams({ preset: 'woman', rate: 1.5, pitch: 1.5 }, 1);
    expect(clamped.pitchFactor).toBe(1.35);
  });

  it('maps phonemes to BOS/PAD/EOS sequences across sentences and skips unknowns', () => {
    const map = {
      '^': [1],
      _: [0],
      $: [2],
      '!': [4],
      '.': [10],
      a: [14],
      b: [15],
    };
    expect(phonemesToIds(['a', 'UNKNOWN', 'b', '!', 'a'], map)).toEqual([
      1, 0, 14, 0, 15, 0, 4, 0, 2, 1, 0, 14, 0, 2,
    ]);
    expect(phonemesToIds([], map)).toEqual([]);
  });
});
