import {
  piperSpeechParams,
  TtsManifestSchema,
  type PiperModelConfig,
  type SpeechPrefs,
  type TtsManifest,
  type TtsRuntime,
  type TtsVoice,
} from '@aplikaacja/shared';
import { useSyncExternalStore } from 'react';
import {
  hasRuntimeFiles,
  listInstalledVoices,
  removeVoice,
  saveRuntimeFiles,
  saveVoice,
  type InstalledVoiceMeta,
} from './storage.ts';
import type { WorkerRequest, WorkerResponse } from './piper.worker.ts';

export interface TtsDownloadProgress {
  loaded: number;
  total: number;
}

export interface TtsState {
  installed: readonly InstalledVoiceMeta[];
  manifest: TtsManifest | null;
  manifestStatus: 'idle' | 'loading' | 'ready' | 'error';
  manifestError: string | null;
  downloads: Readonly<Record<string, TtsDownloadProgress>>;
  downloadErrors: Readonly<Record<string, string>>;
}

const MAX_AUDIO_CACHE = 128;

interface CachedAudio {
  pcm: Float32Array;
  sampleRate: number;
}

let state: TtsState = {
  installed: [],
  manifest: null,
  manifestStatus: 'idle',
  manifestError: null,
  downloads: {},
  downloadErrors: {},
};

const listeners = new Set<() => void>();
const audioCache = new Map<string, CachedAudio>();
const aborters = new Map<string, AbortController>();
const pendingSpeak = new Map<
  number,
  {
    cacheKey: string;
    pitchFactor: number;
    onFallback: () => void;
  }
>();

let worker: Worker | null = null;
let audioCtx: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let speechGen = 0;
let initialized = false;
let manifestPromise: Promise<TtsManifest | null> | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<TtsState>): void {
  state = { ...state, ...patch };
  notify();
}

function initInstalled(): void {
  if (initialized || typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  initialized = true;
  void listInstalledVoices()
    .then((installed) => setState({ installed }))
    .catch(() => undefined);
}

export function subscribeTts(listener: () => void): () => void {
  initInstalled();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTtsState(): TtsState {
  initInstalled();
  return state;
}

export function useTtsState(): TtsState {
  return useSyncExternalStore(subscribeTts, getTtsState);
}

export function isPiperVoiceInstalled(voiceId: string): boolean {
  initInstalled();
  return state.installed.some((v) => v.id === voiceId);
}

export async function loadTtsManifest(force = false): Promise<TtsManifest | null> {
  if (typeof window === 'undefined') return null;
  if (!force && state.manifest) return state.manifest;
  if (!force && manifestPromise) return manifestPromise;

  setState({ manifestStatus: 'loading', manifestError: null });
  manifestPromise = (async () => {
    try {
      const res = await fetch('/tts/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = TtsManifestSchema.parse(await res.json());
      setState({ manifest, manifestStatus: 'ready', manifestError: null });
      return manifest;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Nie udało się pobrać listy głosów offline.';
      setState({ manifestStatus: 'error', manifestError: message });
      return null;
    } finally {
      manifestPromise = null;
    }
  })();
  return manifestPromise;
}

async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(
  url: string,
  signal: AbortSignal,
  onChunk?: (addedBytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nie udało się pobrać ${url} (HTTP ${res.status}).`);
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk?.(buf.byteLength);
    return buf;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
    onChunk?.(value.byteLength);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function setDownloadProgress(voiceId: string, loaded: number, total: number): void {
  setState({
    downloads: { ...state.downloads, [voiceId]: { loaded, total } },
  });
}

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function clearDownload(voiceId: string, error?: string): void {
  const nextDownloads = omitKey(state.downloads, voiceId);
  const nextErrors = error
    ? { ...state.downloadErrors, [voiceId]: error }
    : omitKey(state.downloadErrors, voiceId);
  setState({ downloads: nextDownloads, downloadErrors: nextErrors });
}

export function cancelVoiceDownload(voiceId: string): void {
  aborters.get(voiceId)?.abort();
  aborters.delete(voiceId);
  clearDownload(voiceId);
}

export async function downloadPiperVoice(voice: TtsVoice, runtime: TtsRuntime): Promise<boolean> {
  if (aborters.has(voice.id)) return false;
  const controller = new AbortController();
  aborters.set(voice.id, controller);
  clearDownload(voice.id);

  try {
    const needRuntime = !(await hasRuntimeFiles(runtime.hash));
    const total = voice.bytes + (needRuntime ? runtime.totalBytes : 0);
    let loaded = 0;
    const bump = (n: number) => {
      loaded = Math.min(total, loaded + n);
      setDownloadProgress(voice.id, loaded, total);
    };
    setDownloadProgress(voice.id, 0, total);

    if (needRuntime) {
      // Warm ONNX Runtime files so the Service Worker caches them for offline sessions too.
      const [phonWasm, phonData] = await Promise.all([
        fetchBytes(`/tts/${runtime.phonemizeWasm}`, controller.signal, bump),
        fetchBytes(`/tts/${runtime.phonemizeData}`, controller.signal, bump),
        fetchBytes(`/tts/${runtime.ortMjs}`, controller.signal, bump),
        fetchBytes(`/tts/${runtime.ortWasm}`, controller.signal, bump),
      ]);
      if ((await sha256Hex(phonWasm)) !== runtime.phonemizeWasmSha256) {
        throw new Error('Plik fonemizera jest uszkodzony.');
      }
      if ((await sha256Hex(phonData)) !== runtime.phonemizeDataSha256) {
        throw new Error('Dane języka fonemizera są uszkodzone.');
      }
      await saveRuntimeFiles(runtime.hash, phonWasm.buffer, phonData.buffer);
    }

    const cfgRes = await fetch(`/tts/${voice.config}`, { signal: controller.signal });
    if (!cfgRes.ok)
      throw new Error(`Nie udało się pobrać konfiguracji głosu (HTTP ${cfgRes.status}).`);
    const config = (await cfgRes.json()) as PiperModelConfig;

    const onnx = new Uint8Array(new ArrayBuffer(voice.bytes));
    let offset = 0;
    for (const part of voice.parts) {
      const chunk = await fetchBytes(`/tts/${part}`, controller.signal, bump);
      if (offset + chunk.byteLength > onnx.byteLength) {
        throw new Error('Nieprawidłowy rozmiar pobranego modelu.');
      }
      onnx.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (offset !== voice.bytes || (await sha256Hex(onnx)) !== voice.sha256) {
      throw new Error('Pobrany model głosu nie przeszedł weryfikacji sumy kontrolnej.');
    }

    await saveVoice(
      {
        id: voice.id,
        name: voice.name,
        gender: voice.gender,
        quality: voice.quality,
        sampleRate: voice.sampleRate,
        license: voice.license,
        sourceName: voice.sourceName,
        bytes: voice.bytes,
        sha256: voice.sha256,
        runtimeHash: runtime.hash,
        installedAt: Date.now(),
      },
      config,
      onnx.buffer,
    );

    const installed = await listInstalledVoices();
    setState({ installed });
    clearDownload(voice.id);
    return true;
  } catch (err) {
    if (controller.signal.aborted) {
      clearDownload(voice.id);
      return false;
    }
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    const message = isQuota
      ? 'Brak wolnego miejsca w pamięci przeglądarki na pobranie głosu.'
      : err instanceof Error
        ? err.message
        : 'Nie udało się pobrać głosu.';
    clearDownload(voice.id, message);
    return false;
  } finally {
    aborters.delete(voice.id);
  }
}

export async function deletePiperVoice(voiceId: string): Promise<void> {
  worker?.postMessage({ type: 'dispose', voiceId } satisfies WorkerRequest);
  for (const key of audioCache.keys()) {
    if (key.startsWith(`${voiceId}|`)) audioCache.delete(key);
  }
  const installed = await removeVoice(voiceId);
  setState({ installed });
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') return;
      if (msg.type === 'skipped') {
        pendingSpeak.delete(msg.id);
        return;
      }
      if (msg.type === 'error') {
        if (msg.id !== undefined) {
          const req = pendingSpeak.get(msg.id);
          pendingSpeak.delete(msg.id);
          if (req && msg.id === speechGen) req.onFallback();
        }
        return;
      }
      const req = pendingSpeak.get(msg.id);
      pendingSpeak.delete(msg.id);
      if (!req) return;
      if (msg.pcm.length > 0) {
        rememberAudio(req.cacheKey, { pcm: msg.pcm, sampleRate: msg.sampleRate });
      }
      if (msg.id === speechGen) {
        playPcm(msg.pcm, msg.sampleRate, req.pitchFactor);
      }
    });
  }
  return worker;
}

function rememberAudio(key: string, audio: CachedAudio): void {
  if (audioCache.has(key)) audioCache.delete(key);
  audioCache.set(key, audio);
  if (audioCache.size > MAX_AUDIO_CACHE) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
}

function resumeAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
  return audioCtx;
}

function stopActiveAudio(): void {
  if (!activeSource) return;
  try {
    activeSource.stop();
    activeSource.disconnect();
  } catch {
    // Already stopped.
  }
  activeSource = null;
}

function playPcm(pcm: Float32Array, sampleRate: number, pitchFactor: number): void {
  if (pcm.length === 0) return;
  const ctx = resumeAudioContext();
  if (!ctx) return;
  stopActiveAudio();
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.getChannelData(0).set(pcm);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = pitchFactor;
  source.connect(ctx.destination);
  activeSource = source;
  source.onended = () => {
    if (activeSource === source) activeSource = null;
  };
  source.start();
}

export function cancelPiperSpeech(): void {
  ++speechGen;
  stopActiveAudio();
}

async function resolveRuntimeForVoice(voiceId: string): Promise<TtsRuntime | null> {
  const installed = state.installed.find((v) => v.id === voiceId);
  if (installed) {
    // Build minimal runtime paths matching the hash stored with the installed voice;
    // when manifest is loaded, its exact paths take precedence.
    if (state.manifest) return state.manifest.runtime;
    const h = installed.runtimeHash;
    return {
      hash: h,
      ortMjs: `runtime/${h}/ort-wasm-simd-threaded.mjs`,
      ortWasm: `runtime/${h}/ort-wasm-simd-threaded.wasm`,
      phonemizeWasm: `runtime/${h}/piper_phonemize.wasm`,
      phonemizeData: `runtime/${h}/piper_phonemize.data`,
      phonemizeWasmSha256: '',
      phonemizeDataSha256: '',
      totalBytes: 0,
    };
  }
  const manifest = await loadTtsManifest();
  return manifest?.runtime ?? null;
}

export function warmPiperVoice(voiceId: string): void {
  if (typeof Worker === 'undefined' || !isPiperVoiceInstalled(voiceId)) return;
  void resolveRuntimeForVoice(voiceId).then((runtime) => {
    if (!runtime) return;
    getWorker().postMessage({ type: 'warm', voiceId, runtime } satisfies WorkerRequest);
  });
}

/**
 * Speaks `text` with an installed Piper voice. Synchronously unlocks `AudioContext` on the user
 * gesture; calls `onFallback` if synthesis fails so an AAC tap never stays silent.
 */
export function speakWithPiper(
  text: string,
  voiceId: string,
  prefs: Pick<SpeechPrefs, 'preset' | 'rate' | 'pitch'>,
  onFallback: () => void,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const gen = ++speechGen;
  stopActiveAudio();
  // Must run synchronously inside the tap/click gesture for iOS Safari & mobile Chrome.
  resumeAudioContext();

  const { lengthScale, pitchFactor } = piperSpeechParams(prefs);
  const cacheKey = `${voiceId}|${lengthScale.toFixed(3)}|${trimmed}`;
  const cached = audioCache.get(cacheKey);
  if (cached) {
    audioCache.delete(cacheKey);
    audioCache.set(cacheKey, cached);
    playPcm(cached.pcm, cached.sampleRate, pitchFactor);
    return;
  }

  if (typeof Worker === 'undefined') {
    onFallback();
    return;
  }

  void resolveRuntimeForVoice(voiceId).then((runtime) => {
    if (gen !== speechGen) return;
    if (!runtime) {
      onFallback();
      return;
    }
    pendingSpeak.set(gen, { cacheKey, pitchFactor, onFallback });
    getWorker().postMessage({
      type: 'speak',
      id: gen,
      voiceId,
      runtime,
      text: trimmed,
      lengthScale,
    } satisfies WorkerRequest);
  });
}
