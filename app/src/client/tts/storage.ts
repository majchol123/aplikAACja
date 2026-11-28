import type { PiperModelConfig, TtsVoice } from '@aplikaacja/shared';

const DB_NAME = 'aplikaacja-tts';
const DB_VERSION = 1;
const STORE_META = 'voiceMeta';
const STORE_MODEL = 'voiceModel';
const STORE_RUNTIME = 'runtime';

export interface InstalledVoiceMeta {
  id: string;
  name: string;
  gender: TtsVoice['gender'];
  quality: TtsVoice['quality'];
  sampleRate: number;
  license: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  runtimeHash: string;
  installedAt: number;
}

export interface StoredVoiceModel {
  id: string;
  config: PiperModelConfig;
  onnx: ArrayBuffer;
}

type RuntimeKind = 'phonemize.wasm' | 'phonemize.data';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_MODEL)) {
        db.createObjectStore(STORE_MODEL, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_RUNTIME)) {
        db.createObjectStore(STORE_RUNTIME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

export async function listInstalledVoices(): Promise<InstalledVoiceMeta[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE_META, 'readonly');
    const items = await reqResult(
      tx.objectStore(STORE_META).getAll() as IDBRequest<InstalledVoiceMeta[]>,
    );
    return items.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  } finally {
    db.close();
  }
}

export async function getStoredVoiceModel(id: string): Promise<StoredVoiceModel | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_MODEL, 'readonly');
    const row = await reqResult(
      tx.objectStore(STORE_MODEL).get(id) as IDBRequest<StoredVoiceModel | undefined>,
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function saveVoice(
  meta: InstalledVoiceMeta,
  config: PiperModelConfig,
  onnx: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error('Przeglądarka nie udostępnia pamięci lokalnej (IndexedDB).');
  try {
    const tx = db.transaction([STORE_META, STORE_MODEL], 'readwrite');
    tx.objectStore(STORE_META).put(meta);
    tx.objectStore(STORE_MODEL).put({ id: meta.id, config, onnx } satisfies StoredVoiceModel);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function removeVoice(id: string): Promise<InstalledVoiceMeta[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction([STORE_META, STORE_MODEL], 'readwrite');
    tx.objectStore(STORE_META).delete(id);
    tx.objectStore(STORE_MODEL).delete(id);
    await txDone(tx);
    const readTx = db.transaction(STORE_META, 'readonly');
    const remaining = await reqResult(
      readTx.objectStore(STORE_META).getAll() as IDBRequest<InstalledVoiceMeta[]>,
    );
    if (remaining.length === 0) {
      const cleanTx = db.transaction(STORE_RUNTIME, 'readwrite');
      cleanTx.objectStore(STORE_RUNTIME).clear();
      await txDone(cleanTx);
    }
    return remaining.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  } finally {
    db.close();
  }
}

function runtimeKey(hash: string, kind: RuntimeKind): string {
  return `${hash}:${kind}`;
}

export async function getRuntimeFile(hash: string, kind: RuntimeKind): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(STORE_RUNTIME, 'readonly');
    const row = await reqResult(
      tx.objectStore(STORE_RUNTIME).get(runtimeKey(hash, kind)) as IDBRequest<
        { key: string; bytes: ArrayBuffer } | undefined
      >,
    );
    return row?.bytes ?? null;
  } finally {
    db.close();
  }
}

export async function hasRuntimeFiles(hash: string): Promise<boolean> {
  const [wasm, data] = await Promise.all([
    getRuntimeFile(hash, 'phonemize.wasm'),
    getRuntimeFile(hash, 'phonemize.data'),
  ]);
  return wasm !== null && data !== null;
}

export async function saveRuntimeFiles(
  hash: string,
  wasm: ArrayBuffer,
  data: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error('Przeglądarka nie udostępnia pamięci lokalnej (IndexedDB).');
  try {
    const tx = db.transaction(STORE_RUNTIME, 'readwrite');
    const store = tx.objectStore(STORE_RUNTIME);
    // Drop older runtime versions before writing the current one.
    store.clear();
    store.put({ key: runtimeKey(hash, 'phonemize.wasm'), bytes: wasm });
    store.put({ key: runtimeKey(hash, 'phonemize.data'), bytes: data });
    await txDone(tx);
  } finally {
    db.close();
  }
}
