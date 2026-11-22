import {
  DEFAULT_SETTINGS,
  MIN_HOLD_STEPS,
  polishVoices,
  VOICE_PRESETS,
  type MotorSettings,
  type Settings,
  type SettingsPatch,
  type VoiceInfo,
  type VoicePreset,
} from '@relaacja/shared';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDeviceSettings } from '../device.ts';
import { useAccountSettings, useUpdateAccountSettings } from './account.ts';
import { speak, speechSupported, useVoices } from '../speech.ts';

export const PRESET_LABELS: Record<VoicePreset, string> = {
  woman: 'Kobieta',
  man: 'Mężczyzna',
  girl: 'Dziewczynka',
  boy: 'Chłopiec',
};

const SAMPLE = 'Cześć! Chcę pić sok.';
const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';
const field = 'block text-sm font-medium text-slate-700';
const select =
  'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30';
const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} s`;

type Speech = Settings['speech'];

/**
 * Account voice settings with a local draft: sliders save 400 ms after the last move (and
 * when the panel closes), so dragging does not send a request per step.
 */
function useSpeechDraft() {
  const account = useAccountSettings();
  const update = useUpdateAccountSettings();
  const saved = account.data?.speech ?? DEFAULT_SETTINGS.speech;
  const [draft, setDraft] = useState<Speech | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Speech | null>(null);
  const mutate = useRef(update.mutate);
  useEffect(() => {
    mutate.current = update.mutate;
  }, [update.mutate]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = pending.current;
    pending.current = null;
    if (value) {
      mutate.current(
        { speech: value },
        { onSettled: () => setDraft((d) => (d === value ? null : d)) },
      );
    }
  }, []);
  useEffect(() => flush, [flush]);

  const speech = draft ?? saved;
  const change = (next: Partial<Speech>, delay: number) => {
    const value = { ...speech, ...next };
    setDraft(value);
    pending.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  };
  return { speech, change, ready: account.data !== undefined };
}

/** Checkbox bound to an account setting; shows the new state while the PATCH runs. */
function AccountToggle({
  pick,
  patch,
  children,
}: {
  pick: (s: Settings) => boolean;
  patch: (value: boolean) => SettingsPatch;
  children: ReactNode;
}) {
  const account = useAccountSettings();
  const update = useUpdateAccountSettings();
  const [pending, setPending] = useState<boolean | null>(null);
  return (
    <label className="mt-3 flex items-center gap-3 text-slate-700">
      <input
        type="checkbox"
        className="size-5 accent-brand-700"
        disabled={!account.data || update.isPending}
        checked={pending ?? (account.data ? pick(account.data) : pick(DEFAULT_SETTINGS))}
        onChange={(e) => {
          setPending(e.target.checked);
          update.mutate(patch(e.target.checked), { onSettled: () => setPending(null) });
        }}
      />
      {children}
    </label>
  );
}

function DeviceToggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="mt-3 flex items-center gap-3 text-slate-700">
      <input
        type="checkbox"
        className="size-5 accent-brand-700"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/** Voice, touch and display settings (PLAN §2.4, §2.5). */
export function DevicePanel() {
  const [device, update] = useDeviceSettings();
  const voices = useVoices();
  const polish = polishVoices(voices as readonly VoiceInfo[]);
  const { speech, change, ready } = useSpeechDraft();
  const pinned = device.voices[speech.preset] ?? null;
  const motor = (patch: Partial<MotorSettings>) => update({ motor: { ...device.motor, ...patch } });
  const id = useId();

  return (
    <>
      <section className={card} aria-labelledby={`${id}-voice`}>
        <h2 id={`${id}-voice`} className="text-lg font-bold text-brand-900">
          Głos
        </h2>
        {!speechSupported ? (
          <p className="mt-2 text-red-700">Ta przeglądarka nie obsługuje czytania na głos.</p>
        ) : (
          polish.length === 0 && (
            <p className="mt-2 text-amber-800">
              Brak polskiego głosu w systemie. Zainstaluj go w ustawieniach urządzenia (Mowa /
              Zamiana tekstu na mowę); do tego czasu przeglądarka użyje głosu domyślnego.
            </p>
          )
        )}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={field}>
            Rodzaj głosu (na koncie)
            <select
              className={select}
              disabled={!ready}
              value={speech.preset}
              onChange={(e) => change({ preset: e.target.value as VoicePreset }, 0)}
            >
              {VOICE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Głos syntezatora dla „{PRESET_LABELS[speech.preset]}” (na tym urządzeniu)
            <select
              className={select}
              value={pinned ?? ''}
              onChange={(e) =>
                update({ voices: { ...device.voices, [speech.preset]: e.target.value || null } })
              }
            >
              <option value="">Automatycznie</option>
              {polish.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                  {v.localService ? '' : ' (wymaga internetu)'}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Tempo: {Math.round(speech.rate * 100)}%
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              disabled={!ready}
              value={speech.rate}
              onChange={(e) => change({ rate: Number(e.target.value) }, 400)}
              className="mt-3 w-full accent-brand-700"
            />
          </label>
          <label className={field}>
            Wysokość: {Math.round(speech.pitch * 100)}%
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              disabled={!ready}
              value={speech.pitch}
              onChange={(e) => change({ pitch: Number(e.target.value) }, 400)}
              className="mt-3 w-full accent-brand-700"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => speak(SAMPLE, { ...speech, voiceURI: pinned })}
          className="mt-4 rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-800"
        >
          Test głosu
        </button>
        <DeviceToggle checked={device.speakOnTap} onChange={(v) => update({ speakOnTap: v })}>
          Czytaj słowo od razu po dotknięciu kafelka (na tym urządzeniu)
        </DeviceToggle>
      </section>

      <section className={card} aria-labelledby={`${id}-touch`}>
        <h2 id={`${id}-touch`} className="text-lg font-bold text-brand-900">
          Dotyk na tym urządzeniu
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className={field}>
            Kafelek działa
            <select
              className={select}
              value={device.motor.activateOn}
              onChange={(e) => motor({ activateOn: e.target.value as 'release' | 'press' })}
            >
              <option value="release">po oderwaniu palca</option>
              <option value="press">od razu po dotknięciu</option>
            </select>
          </label>
          <label className={field}>
            Minimalny czas przytrzymania
            <select
              className={select}
              disabled={device.motor.activateOn === 'press'}
              value={device.motor.minHoldMs}
              onChange={(e) =>
                motor({ minHoldMs: Number(e.target.value) as MotorSettings['minHoldMs'] })
              }
            >
              {MIN_HOLD_STEPS.map((ms) => (
                <option key={ms} value={ms}>
                  {ms === 0 ? 'wyłączony' : seconds(ms)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Ten sam kafelek ponownie najwcześniej po: {seconds(device.motor.sameTileGuardMs)}
            <input
              type="range"
              min={0}
              max={2000}
              step={100}
              value={device.motor.sameTileGuardMs}
              onChange={(e) => motor({ sameTileGuardMs: Number(e.target.value) })}
              className="mt-3 w-full accent-brand-700"
            />
          </label>
          <label className={field}>
            Przerwa po każdym dotknięciu: {seconds(device.motor.globalGuardMs)}
            <input
              type="range"
              min={0}
              max={1000}
              step={50}
              value={device.motor.globalGuardMs}
              onChange={(e) => motor({ globalGuardMs: Number(e.target.value) })}
              className="mt-3 w-full accent-brand-700"
            />
          </label>
        </div>
        <DeviceToggle checked={device.feedback} onChange={(v) => update({ feedback: v })}>
          Podświetlenie i wibracja po dotknięciu
        </DeviceToggle>
      </section>

      <section className={card} aria-labelledby={`${id}-behaviour`}>
        <h2 id={`${id}-behaviour`} className="text-lg font-bold text-brand-900">
          Tablice (na wszystkich urządzeniach)
        </h2>
        <AccountToggle pick={(s) => s.returnToHome} patch={(v) => ({ returnToHome: v })}>
          Po wybraniu słowa w folderze wracaj na pulpit
        </AccountToggle>
        <AccountToggle pick={(s) => s.uppercaseLabels} patch={(v) => ({ uppercaseLabels: v })}>
          Etykiety wielkimi literami
        </AccountToggle>
      </section>
    </>
  );
}
