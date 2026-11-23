import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_WINDOWS_LOCAL_RATE,
  localVoiceRate,
  planSpeech,
  polishVoices,
  voiceGender,
  type VoiceInfo,
} from './speech.ts';

const voice = (
  name: string,
  lang = 'pl-PL',
  localService = true,
  isDefault = false,
): VoiceInfo => ({
  voiceURI: name,
  name,
  lang,
  localService,
  default: isDefault,
});

// Voice lists as reported by typical devices.
const WINDOWS_EDGE = [
  voice('Microsoft Paulina - Polish (Poland)'),
  voice('Microsoft Zofia Online (Natural) - Polish (Poland)', 'pl-PL', false),
  voice('Microsoft Marek Online (Natural) - Polish (Poland)', 'pl-PL', false),
  voice('Microsoft David - English (United States)', 'en-US', true, true),
];
const ANDROID = [
  voice('pl-pl-x-oda-local'),
  voice('pl-pl-x-bmg-local'),
  voice('Google polski', 'pl_PL'),
];
const IPAD = [voice('Zosia', 'pl-PL'), voice('Samantha', 'en-US', true, true)];

describe('voice selection', () => {
  it('guesses gender from known voice names only', () => {
    expect(voiceGender(voice('Microsoft Paulina - Polish (Poland)'))).toBe('female');
    expect(voiceGender(voice('Microsoft Marek Online (Natural)'))).toBe('male');
    expect(voiceGender(voice('Google polski'))).toBe('female');
    expect(voiceGender(voice('Krzysztof'))).toBe('male');
    expect(voiceGender(voice('pl-pl-x-bmg-local'))).toBeNull();
    expect(voiceGender(voice('Female voice 2'))).toBe('female');
  });

  it('keeps Polish voices, offline ones first', () => {
    expect(polishVoices(WINDOWS_EDGE).map((v) => v.name)).toEqual([
      'Microsoft Paulina - Polish (Poland)',
      'Microsoft Zofia Online (Natural) - Polish (Poland)',
      'Microsoft Marek Online (Natural) - Polish (Poland)',
    ]);
    expect(polishVoices(ANDROID)).toHaveLength(3);
    expect(polishVoices([voice('Samantha', 'en-US')])).toEqual([]);
  });

  it('maps presets to voice, pitch and rate', () => {
    const prefs = { voiceURI: null, rate: 1, pitch: 1 } as const;
    expect(planSpeech(WINDOWS_EDGE, { ...prefs, preset: 'woman' })).toEqual({
      voiceURI: 'Microsoft Paulina - Polish (Poland)',
      lang: 'pl-PL',
      pitch: 1,
      rate: 0.95,
    });
    expect(planSpeech(WINDOWS_EDGE, { ...prefs, preset: 'man' }).voiceURI).toContain('Marek');
    const girl = planSpeech(WINDOWS_EDGE, { ...prefs, preset: 'girl' });
    expect(girl.voiceURI).toContain('Paulina');
    expect(girl.pitch).toBeGreaterThan(1.3);
    expect(girl.rate).toBeCloseTo(1.05);
  });

  it('shifts pitch when only a voice of the other gender exists', () => {
    const man = planSpeech(IPAD, { preset: 'man', voiceURI: null, rate: 1, pitch: 1 });
    expect(man.voiceURI).toBe('Zosia');
    expect(man.pitch).toBeLessThan(1);
    const boy = planSpeech(IPAD, { preset: 'boy', voiceURI: null, rate: 1, pitch: 1 });
    expect(boy.pitch).toBeGreaterThan(1);
  });

  it('honours a voice pinned on the device and the speed setting', () => {
    const plan = planSpeech(ANDROID, {
      preset: 'boy',
      voiceURI: 'pl-pl-x-bmg-local',
      rate: 0.8,
      pitch: 1.2,
    });
    expect(plan.voiceURI).toBe('pl-pl-x-bmg-local');
    expect(plan.rate).toBeCloseTo(0.84);
    expect(plan.pitch).toBeCloseTo(1.74); // 1.45 × 1.2
    // A pinned voice that disappeared (OS update) falls back to automatic choice.
    expect(
      planSpeech(IPAD, { preset: 'woman', voiceURI: 'gone', rate: 1, pitch: 1 }).voiceURI,
    ).toBe('Zosia');
  });

  it('lets the browser choose when there is no Polish voice at all', () => {
    const plan = planSpeech([voice('Samantha', 'en-US')], {
      preset: 'girl',
      voiceURI: null,
      rate: 9,
      pitch: 1,
    });
    expect(plan).toMatchObject({ voiceURI: null, lang: 'pl-PL', pitch: 1.6 });
    expect(plan.rate).toBeCloseTo(1.575); // speed clamped to 1.5 × preset 1.05
  });

  it('slows the Windows voices down in Chromium browsers other than Edge only', () => {
    const ua = (tail: string) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${tail}`;
    const chrome = ua('Chrome/142.0.0.0 Safari/537.36');
    expect(localVoiceRate(chrome)).toBe(CHROMIUM_WINDOWS_LOCAL_RATE);
    expect(localVoiceRate(ua('Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0'))).toBe(1);
    expect(localVoiceRate(ua('Chrome/142.0.0.0 Safari/537.36 OPR/120.0.0.0'))).toBe(0.6);
    expect(
      localVoiceRate(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
      ),
    ).toBe(1);
    expect(
      localVoiceRate(
        'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      ),
    ).toBe(1);
    expect(
      localVoiceRate(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      ),
    ).toBe(1);

    const prefs = { preset: 'woman', voiceURI: null, rate: 1, pitch: 1 } as const;
    // The slider's 100% plays the installed voice at 0.6 of the preset's rate…
    expect(planSpeech(WINDOWS_EDGE, prefs, 0.6).rate).toBeCloseTo(0.57); // 0.95 × 0.6
    // …but an online voice as it is.
    const online = 'Microsoft Zofia Online (Natural) - Polish (Poland)';
    expect(planSpeech(WINDOWS_EDGE, { ...prefs, voiceURI: online }, 0.6).rate).toBeCloseTo(0.95);
    // The slowest setting still sounds like speech.
    expect(planSpeech(WINDOWS_EDGE, { ...prefs, rate: 0.5 }, 0.6).rate).toBeCloseTo(0.285);
  });
});
