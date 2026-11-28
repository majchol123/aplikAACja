import createPiperPhonemize, {
  type PiperPhonemizeModule,
} from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import { phonemesToIds, type PiperModelConfig, type TtsRuntime } from '@aplikaacja/shared';
import * as ort from 'onnxruntime-web/wasm';
import { getRuntimeFile, getStoredVoiceModel } from './storage.ts';

export type WorkerRequest =
  | { type: 'warm'; voiceId: string; runtime: TtsRuntime }
  | {
      type: 'speak';
      id: number;
      voiceId: string;
      runtime: TtsRuntime;
      text: string;
      lengthScale: number;
    }
  | { type: 'dispose'; voiceId?: string };

export type WorkerResponse =
  | { type: 'ready'; voiceId: string }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'skipped'; id: number }
  | { type: 'error'; id?: number; message: string };

interface WorkerScope {
  location: Location;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const workerScope = self as unknown as WorkerScope;

let phonemizerPromise: Promise<PiperPhonemizeModule> | null = null;
let phonemizerHash: string | null = null;
let printHandler: ((line: string) => void) | null = null;
let errHandler: ((line: string) => void) | null = null;

let ortConfiguredHash: string | null = null;
let activeVoiceId: string | null = null;
let activeConfig: PiperModelConfig | null = null;
let activeSession: ort.InferenceSession | null = null;
let latestSpeakId = 0;
let queue: Promise<void> = Promise.resolve();

function configureOrt(runtime: TtsRuntime): void {
  if (ortConfiguredHash === runtime.hash) return;
  const origin = workerScope.location.origin;
  ort.env.wasm.wasmPaths = {
    mjs: new URL(`/tts/${runtime.ortMjs}`, origin).href,
    wasm: new URL(`/tts/${runtime.ortWasm}`, origin).href,
  };
  ortConfiguredHash = runtime.hash;
}

async function ensurePhonemizer(runtime: TtsRuntime): Promise<PiperPhonemizeModule> {
  if (phonemizerPromise && phonemizerHash === runtime.hash) return phonemizerPromise;
  phonemizerHash = runtime.hash;
  phonemizerPromise = (async () => {
    const [wasmBinary, dataBinary] = await Promise.all([
      getRuntimeFile(runtime.hash, 'phonemize.wasm'),
      getRuntimeFile(runtime.hash, 'phonemize.data'),
    ]);
    if (!wasmBinary || !dataBinary) {
      throw new Error('Brak plików silnika mowy w pamięci urządzenia.');
    }
    return createPiperPhonemize({
      wasmBinary,
      getPreloadedPackage: () => dataBinary,
      locateFile: (file) =>
        `/tts/${file.endsWith('.wasm') ? runtime.phonemizeWasm : runtime.phonemizeData}`,
      print: (line) => printHandler?.(line),
      printErr: (line) => errHandler?.(line),
    });
  })().catch((err) => {
    phonemizerPromise = null;
    phonemizerHash = null;
    throw err;
  });
  return phonemizerPromise;
}

async function ensureVoice(voiceId: string, runtime: TtsRuntime): Promise<void> {
  configureOrt(runtime);
  await ensurePhonemizer(runtime);
  if (activeVoiceId === voiceId && activeSession && activeConfig) return;

  if (activeSession) {
    await activeSession.release();
    activeSession = null;
    activeVoiceId = null;
    activeConfig = null;
  }

  const stored = await getStoredVoiceModel(voiceId);
  if (!stored) throw new Error(`Głos ${voiceId} nie jest zapisany na urządzeniu.`);
  activeSession = await ort.InferenceSession.create(stored.onnx, {
    executionProviders: ['wasm'],
  });
  activeConfig = stored.config;
  activeVoiceId = voiceId;
}

function phonemize(module: PiperPhonemizeModule, espeakVoice: string, text: string): string[] {
  const phonemes: string[] = [];
  let stderr = '';
  printHandler = (line) => {
    const parsed = JSON.parse(line) as { phonemes?: string[] };
    if (Array.isArray(parsed.phonemes)) phonemes.push(...parsed.phonemes);
  };
  errHandler = (line) => {
    stderr += `${line}\n`;
  };
  try {
    module.callMain([
      '-l',
      espeakVoice,
      '--input',
      JSON.stringify([{ text: text.trim() }]),
      '--espeak_data',
      '/espeak-ng-data',
    ]);
  } finally {
    printHandler = null;
    errHandler = null;
  }
  if (phonemes.length === 0 && stderr.trim()) {
    throw new Error(stderr.trim());
  }
  return phonemes;
}

async function synthesize(
  voiceId: string,
  runtime: TtsRuntime,
  text: string,
  lengthScale: number,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  await ensureVoice(voiceId, runtime);
  const phonemizer = await ensurePhonemizer(runtime);
  const config = activeConfig;
  const session = activeSession;
  if (!config || !session) throw new Error('Sesja głosu nie jest gotowa.');

  const phonemes = phonemize(phonemizer, config.espeak?.voice || 'pl', text);
  const ids = phonemesToIds(phonemes, config.phoneme_id_map);
  if (ids.length === 0) {
    return { pcm: new Float32Array(0), sampleRate: config.audio.sample_rate };
  }

  const input = new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const inputLengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]);
  const scales = new ort.Tensor(
    'float32',
    Float32Array.from([
      config.inference.noise_scale ?? 0.667,
      lengthScale,
      config.inference.noise_w ?? 0.8,
    ]),
    [3],
  );
  const feeds: Record<string, ort.Tensor> = {
    input,
    input_lengths: inputLengths,
    scales,
  };
  const hasSpeakers = config.speaker_id_map && Object.keys(config.speaker_id_map).length > 0;
  const sid = hasSpeakers ? new ort.Tensor('int64', BigInt64Array.from([0n]), [1]) : null;
  if (sid) feeds.sid = sid;

  const outputs = await session.run(feeds);
  try {
    const outTensor = outputs.output ?? Object.values(outputs)[0];
    if (!outTensor) throw new Error('Model nie zwrócił próbki audio.');
    // Copy out of WASM-backed memory before transferring ownership to the main thread.
    const pcm = new Float32Array(outTensor.data as Float32Array);
    return { pcm, sampleRate: config.audio.sample_rate };
  } finally {
    input.dispose();
    inputLengths.dispose();
    scales.dispose();
    sid?.dispose();
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

async function handleMessage(msg: WorkerRequest): Promise<void> {
  if (msg.type === 'dispose') {
    if (!msg.voiceId || msg.voiceId === activeVoiceId) {
      await activeSession?.release();
      activeSession = null;
      activeVoiceId = null;
      activeConfig = null;
    }
    return;
  }

  if (msg.type === 'warm') {
    try {
      await ensureVoice(msg.voiceId, msg.runtime);
      workerScope.postMessage({ type: 'ready', voiceId: msg.voiceId });
    } catch (err) {
      workerScope.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }

  if (msg.id < latestSpeakId) {
    workerScope.postMessage({ type: 'skipped', id: msg.id });
    return;
  }

  try {
    const { pcm, sampleRate } = await synthesize(
      msg.voiceId,
      msg.runtime,
      msg.text,
      msg.lengthScale,
    );
    if (msg.id < latestSpeakId) {
      workerScope.postMessage({ type: 'skipped', id: msg.id });
      return;
    }
    workerScope.postMessage({ type: 'audio', id: msg.id, pcm, sampleRate }, [pcm.buffer]);
  } catch (err) {
    workerScope.postMessage({ type: 'error', id: msg.id, message: String(err) });
  }
}

workerScope.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'speak') latestSpeakId = Math.max(latestSpeakId, msg.id);
  queue = queue.then(() => handleMessage(msg));
});
