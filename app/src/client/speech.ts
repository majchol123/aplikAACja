import { DEFAULT_SETTINGS, planSpeech, type SpeechPrefs, type VoiceInfo } from '@aplikaacja/shared';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useDeviceSettings } from './device.ts';
import { useAccountSettings } from './settings/account.ts';

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

let voices: SpeechSynthesisVoice[] = synth?.getVoices() ?? [];

function subscribe(listener: () => void): () => void {
  if (!synth) return () => undefined;
  // Voice lists load asynchronously (Chrome) and change when the OS installs voices.
  const onChange = () => {
    voices = synth.getVoices();
    listener();
  };
  synth.addEventListener('voiceschanged', onChange);
  onChange();
  return () => synth.removeEventListener('voiceschanged', onChange);
}

export const speechSupported = synth !== null;

export function useVoices(): readonly SpeechSynthesisVoice[] {
  return useSyncExternalStore(subscribe, () => voices);
}

export function speak(text: string, prefs: SpeechPrefs): void {
  if (!synth || !text.trim()) return;
  const available = synth.getVoices();
  const plan = planSpeech(available as readonly VoiceInfo[], prefs);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = plan.lang;
  utterance.pitch = plan.pitch;
  utterance.rate = plan.rate;
  const voice = available.find((v) => v.voiceURI === plan.voiceURI);
  if (voice) utterance.voice = voice;
  // A new word interrupts the previous one instead of queueing behind it.
  synth.cancel();
  synth.speak(utterance);
}

/** Account preset and sliders + the system voice this device plays for that preset. */
export function useSpeechPrefs(): SpeechPrefs {
  const [device] = useDeviceSettings();
  const account = useAccountSettings();
  const speech = account.data?.speech ?? DEFAULT_SETTINGS.speech;
  const voiceURI = device.voices[speech.preset] ?? null;
  return useMemo(() => ({ ...speech, voiceURI }), [speech, voiceURI]);
}

export function useSpeaker(): (text: string) => void {
  const prefs = useSpeechPrefs();
  return useCallback((text: string) => speak(text, prefs), [prefs]);
}
