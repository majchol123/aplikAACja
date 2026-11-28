import {
  DEFAULT_SETTINGS,
  MIN_HOLD_STEPS,
  piperVoiceIdFromURI,
  piperVoiceURI,
  polishVoices,
  VOICE_PRESETS,
  type LabelPosition,
  type MotorSettings,
  type Settings,
  type SettingsPatch,
  type TileMin,
  type VoiceInfo,
  type VoicePreset,
} from '@aplikaacja/shared';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFitGrid } from '../boards/layout.ts';
import { useDeviceSettings } from '../device.ts';
import { useAccountSettings, useUpdateAccountSettings } from './account.ts';
import { speak, speechSupported, useVoices } from '../speech.ts';
import {
  cancelVoiceDownload,
  deletePiperVoice,
  downloadPiperVoice,
  loadTtsManifest,
  useTtsState,
  warmPiperVoice,
} from '../tts/manager.ts';

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
const megabytes = (bytes: number) =>
  `${Math.max(1, Math.round(bytes / (1024 * 1024))).toLocaleString('pl-PL')} MB`;

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

/** Where labels go on every tile that has no place of its own (set in the tile editor). */
function LabelPlace() {
  const id = useId();
  const account = useAccountSettings();
  const update = useUpdateAccountSettings();
  const [pending, setPending] = useState<LabelPosition | null>(null);
  return (
    <div className="mt-4">
      <label className={`${field} sm:max-w-sm`}>
        Etykiety na kafelkach
        <select
          className={select}
          disabled={!account.data || update.isPending}
          value={pending ?? (account.data ?? DEFAULT_SETTINGS).labelPosition}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const labelPosition = e.target.value as LabelPosition;
            setPending(labelPosition);
            update.mutate({ labelPosition }, { onSettled: () => setPending(null) });
          }}
        >
          <option value="top">nad obrazkiem</option>
          <option value="bottom">pod obrazkiem</option>
        </select>
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-slate-600">
        Kafelek, któremu w trybie edycji wybrano inne położenie, zostaje przy swoim.
      </p>
    </div>
  );
}

export function DeviceToggle({
  checked,
  onChange,
  hint,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <label className="mt-3 flex items-center gap-3 text-slate-700">
        <input
          type="checkbox"
          className="size-5 accent-brand-700"
          checked={checked}
          aria-describedby={hint ? id : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        {children}
      </label>
      {hint && (
        <p id={id} className="mt-1 pl-8 text-sm text-slate-600">
          {hint}
        </p>
      )}
    </>
  );
}

/** Voice, touch and display settings (PLAN §2.4, §2.5). */
export function DevicePanel() {
  const [device, update] = useDeviceSettings();
  const voices = useVoices();
  const polish = polishVoices(voices as readonly VoiceInfo[]);
  const { speech, change, ready } = useSpeechDraft();
  const pinned = device.voices[speech.preset] ?? null;
  const tts = useTtsState();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const motor = (patch: Partial<MotorSettings>) => update({ motor: { ...device.motor, ...patch } });
  const fitGrid = useFitGrid();
  const id = useId();

  const installedIds = new Set(tts.installed.map((v) => v.id));
  const manifestNames = new Map(tts.manifest?.voices.map((v) => [v.id, v.name]));
  const voiceName = (v: { id: string; name: string }) => manifestNames.get(v.id) ?? v.name;
  const pinnedPiperId = piperVoiceIdFromURI(pinned);
  const hasAnyVoice = speechSupported || tts.installed.length > 0;

  useEffect(() => {
    if (pinnedPiperId && installedIds.has(pinnedPiperId)) warmPiperVoice(pinnedPiperId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedPiperId, tts.installed.length]);

  const openCatalog = () => {
    setCatalogOpen((open) => !open);
    if (!tts.manifest && tts.manifestStatus !== 'loading') void loadTtsManifest();
  };

  const handleDownload = async (voiceId: string) => {
    if (!tts.manifest) return;
    const voice = tts.manifest.voices.find((v) => v.id === voiceId);
    if (!voice) return;
    const ok = await downloadPiperVoice(voice, tts.manifest.runtime);
    if (ok && !device.voices[speech.preset]) {
      update({ voices: { ...device.voices, [speech.preset]: piperVoiceURI(voice.id) } });
    }
  };

  const handleDelete = async (voiceId: string) => {
    await deletePiperVoice(voiceId);
    const targetUri = piperVoiceURI(voiceId);
    const nextVoices = { ...device.voices };
    let changed = false;
    for (const preset of VOICE_PRESETS) {
      if (nextVoices[preset] === targetUri) {
        nextVoices[preset] = null;
        changed = true;
      }
    }
    if (changed) update({ voices: nextVoices });
  };

  return (
    <>
      <section className={card} aria-labelledby={`${id}-voice`}>
        <h2 id={`${id}-voice`} className="text-lg font-bold text-brand-900">
          Głos
        </h2>
        {!hasAnyVoice ? (
          <p className="mt-2 text-red-700">Ta przeglądarka nie obsługuje czytania na głos.</p>
        ) : (
          polish.length === 0 &&
          tts.installed.length === 0 && (
            <p className="mt-2 text-amber-800">
              Brak polskiego głosu w systemie. Zainstaluj go w ustawieniach urządzenia (Mowa /
              Zamiana tekstu na mowę) albo pobierz ulepszony głos offline poniżej; do tego czasu
              przeglądarka użyje głosu domyślnego.
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
              {tts.installed.length > 0 && (
                <optgroup label="Głosy ulepszone (offline na urządzeniu)">
                  {tts.installed.map((v) => (
                    <option key={v.id} value={piperVoiceURI(v.id)}>
                      {voiceName(v)} ({v.gender === 'female' ? 'kobiecy' : 'męski'}, offline)
                    </option>
                  ))}
                </optgroup>
              )}
              {tts.installed.length > 0 ? (
                <optgroup label="Głosy systemu i przeglądarki">
                  {polish.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                      {v.localService ? '' : ' (wymaga internetu)'}
                    </option>
                  ))}
                </optgroup>
              ) : (
                polish.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name}
                    {v.localService ? '' : ' (wymaga internetu)'}
                  </option>
                ))
              )}
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
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => speak(SAMPLE, { ...speech, voiceURI: pinned })}
            className="rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-800"
          >
            Test głosu
          </button>
          <button
            type="button"
            aria-expanded={catalogOpen}
            onClick={openCatalog}
            className="rounded-full border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
          >
            {catalogOpen ? 'Ukryj głosy offline' : 'Pobierz ulepszony głos (offline)'}
          </button>
        </div>

        {(catalogOpen || tts.installed.length > 0) && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">Ulepszone głosy offline</h3>
            <p className="mt-1 text-sm text-slate-600">
              Wyraźniejsze polskie głosy działające w całości w przeglądarce — po pobraniu także bez
              internetu. Czytany tekst nigdy nie opuszcza urządzenia.
              {tts.manifest && tts.installed.length === 0 && (
                <>
                  {' '}
                  Pierwsze pobranie pobiera również silnik mowy (
                  {megabytes(tts.manifest.runtime.totalBytes)}).
                </>
              )}
            </p>

            {tts.installed.length > 0 && !catalogOpen && (
              <ul className="mt-3 space-y-2">
                {tts.installed.map((v) => {
                  const uri = piperVoiceURI(v.id);
                  const active = pinned === uri;
                  return (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200"
                    >
                      <div className="text-sm">
                        <span className="font-semibold text-slate-800">{voiceName(v)}</span>{' '}
                        <span className="text-slate-600">
                          ({v.gender === 'female' ? 'kobiecy' : 'męski'}, {megabytes(v.bytes)})
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {active ? (
                          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
                            Aktywny dla „{PRESET_LABELS[speech.preset]}”
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              update({ voices: { ...device.voices, [speech.preset]: uri } })
                            }
                            className="rounded-full border border-brand-700 px-3 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                          >
                            Użyj teraz
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDelete(v.id)}
                          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Usuń
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {catalogOpen && (
              <>
                {tts.manifestStatus === 'loading' && (
                  <p className="mt-3 text-sm text-slate-600">Ładowanie listy głosów offline…</p>
                )}
                {tts.manifestStatus === 'error' && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-red-700" role="alert">
                      Nie udało się pobrać listy głosów ({tts.manifestError}).
                    </p>
                    <button
                      type="button"
                      onClick={() => void loadTtsManifest(true)}
                      className="rounded-full border border-brand-700 px-3 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                    >
                      Spróbuj ponownie
                    </button>
                  </div>
                )}
                {tts.manifest && (
                  <ul className="mt-3 space-y-2">
                    {tts.manifest.voices.map((v) => {
                      const uri = piperVoiceURI(v.id);
                      const installed = installedIds.has(v.id);
                      const active = pinned === uri;
                      const progress = tts.downloads[v.id];
                      const error = tts.downloadErrors[v.id];
                      const pct =
                        progress && progress.total > 0
                          ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
                          : 0;
                      return (
                        <li
                          key={v.id}
                          className="rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm">
                              <span className="font-semibold text-slate-800">{v.name}</span>{' '}
                              <span className="text-slate-600">
                                ({v.gender === 'female' ? 'kobiecy' : 'męski'}, {megabytes(v.bytes)}
                                )
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {progress ? (
                                <>
                                  <span className="text-xs font-medium text-slate-600">
                                    {pct}% ({megabytes(progress.loaded)} /{' '}
                                    {megabytes(progress.total)})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => cancelVoiceDownload(v.id)}
                                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                  >
                                    Anuluj
                                  </button>
                                </>
                              ) : installed ? (
                                <>
                                  {active ? (
                                    <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
                                      Aktywny dla „{PRESET_LABELS[speech.preset]}”
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        update({
                                          voices: { ...device.voices, [speech.preset]: uri },
                                        })
                                      }
                                      className="rounded-full border border-brand-700 px-3 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-50"
                                    >
                                      Użyj teraz
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void handleDelete(v.id)}
                                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                  >
                                    Usuń
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleDownload(v.id)}
                                  className="rounded-full bg-brand-700 px-3.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
                                >
                                  Pobierz
                                </button>
                              )}
                            </div>
                          </div>
                          {progress && (
                            <progress
                              aria-label={`Pobieranie głosu ${v.name}`}
                              value={progress.loaded}
                              max={Math.max(1, progress.total)}
                              className="mt-2 h-2 w-full accent-brand-700"
                            />
                          )}
                          {error && (
                            <p className="mt-1.5 text-xs text-red-700" role="alert">
                              {error}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

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
          <div>
            <label className={field}>
              Najmniejsze kafelki
              <select
                className={select}
                value={device.tileMin}
                aria-describedby={`${id}-tile-min`}
                onChange={(e) => update({ tileMin: e.target.value as TileMin })}
              >
                <option value="S">małe</option>
                <option value="M">średnie</option>
                <option value="L">duże</option>
                <option value="fit">bez przewijania: cała tablica na ekranie</option>
              </select>
            </label>
            <p id={`${id}-tile-min`} className="mt-1 text-sm text-slate-600">
              Tablica do sześciu rzędów mieści się w wysokości ekranu. Większa lub mająca wiele
              kolumn na wąskim ekranie, na której kafelki byłyby mniejsze, przewija się w dół lub w
              bok — palcem albo paskiem.
            </p>
          </div>
        </div>
        <DeviceToggle checked={device.feedback} onChange={(v) => update({ feedback: v })}>
          Podświetlenie i wibracja po dotknięciu
        </DeviceToggle>
        <DeviceToggle
          checked={fitGrid}
          onChange={(v) => update({ fitGrid: v })}
          hint="W pionie tablica 6×4 pokazuje się jako 4×6, z większymi kafelkami: pierwszy wiersz staje się pierwszą kolumną. Słowo ma wtedy inne miejsce w pionie, a inne w poziomie. Domyślnie włączone na telefonach."
        >
          Dopasuj siatkę do orientacji ekranu
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
        <LabelPlace />
        <AccountToggle pick={(s) => s.showAllSymbols} patch={(v) => ({ showAllSymbols: v })}>
          Folder „Wszystkie symbole” w pierwszym polu pulpitu: kategorie zestawów symboli, także dla
          osób, które nie czytają (wyłączony zostawia to pole puste)
        </AccountToggle>
        <AccountToggle
          pick={(s) => s.showPhraseGenerator}
          patch={(v) => ({ showPhraseGenerator: v })}
        >
          Przycisk „Generator fraz” przy tablicy: zdanie wpisane z klawiatury zamienia się w symbole
        </AccountToggle>
        <AccountToggle pick={(s) => s.keepHistory} patch={(v) => ({ keepHistory: v })}>
          Zapisuj historię wypowiedzi: ostatnie 50 na koncie, takie same na każdym urządzeniu
          (wyłączenie usuwa zapisaną historię)
        </AccountToggle>
        <AccountToggle pick={(s) => s.usageStats} patch={(v) => ({ usageStats: v })}>
          Liczniki użycia dla administratora: ile zdań i kafelków dziennie, bez słów i bez tego,
          które to kafelki (wyłączenie usuwa zebrane liczniki)
        </AccountToggle>
      </section>
    </>
  );
}
