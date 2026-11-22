import { describe, expect, it } from 'vitest';
import { planSpeech, polishVoices, voiceGender, type VoiceInfo } from './speech.ts';

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
});
