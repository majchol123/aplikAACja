import type {
  BoardTree,
  DeviceSettings,
  FavoriteList,
  HistoryList,
  Me,
  MediaList,
  PreferredSymbols,
  Settings,
  SymbolRef,
  UsageList,
} from '@aplikaacja/shared';
import { mediaUrl } from '@aplikaacja/shared';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { api } from '../api.ts';
import { exportBoardFile } from '../shares/files.ts';

const EXT: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** A name part that every file system accepts. */
const safe = (text: string) =>
  text
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_')
    .trim()
    .slice(0, 60) || 'zdjecie';

const README = (at: string) => `Kopia danych konta aplikAACja z ${at}

tablice.obz   wszystkie tablice z folderami i obrazkami (Open Board Format):
              otworzy je aplikAACja („Dodaj tablicę” → „Z pliku”) i inne aplikacje AAC
dane.json     konto, ustawienia, ulubione frazy, historia wypowiedzi, wybrane warianty
              symboli, liczniki użycia (liczby zdań i kafelków na dzień), ustawienia
              tego urządzenia i spis zdjęć
zdjecia/      wszystkie Twoje zdjęcia, także te, których nie ma na tablicach

Symbole dodatkowego zestawu są w plikach tylko jako odwołania (bez obrazków).
`;

/**
 * Everything the account holds, as one ZIP built in the browser (GDPR art. 20): the boards
 * as an .obz file, the rest as JSON, the photos as they were saved. `onProgress` tells
 * what is being fetched.
 */
export async function exportAccount(
  me: Me,
  device: DeviceSettings,
  resolve: (symbol: SymbolRef) => string | null,
  onProgress: (text: string) => void,
): Promise<{ blob: Blob; name: string; missing: number }> {
  onProgress('Pobieranie danych konta…');
  const [tree, settings, favorites, history, preferred, media, usage] = await Promise.all([
    api<BoardTree>('/api/boards'),
    api<Settings>('/api/settings'),
    api<FavoriteList>('/api/favorites'),
    api<HistoryList>('/api/history'),
    api<PreferredSymbols>('/api/symbols/preferred'),
    api<MediaList>('/api/media'),
    api<UsageList>('/api/usage'),
  ]);
  const files: Zippable = {};
  let missing = 0;
  if (tree.homeId) {
    onProgress('Zapisywanie tablic…');
    const boards = await exportBoardFile(tree, tree.homeId, resolve);
    missing += boards.missing;
    files['tablice.obz'] = [new Uint8Array(await boards.blob.arrayBuffer()), { level: 0 }];
  }
  const photos: { id: string; label: string; file: string | null; createdAt: number }[] = [];
  let done = 0;
  for (const item of media.items) {
    onProgress(`Pobieranie zdjęć: ${++done} z ${media.items.length}…`);
    const file = `zdjecia/${String(done).padStart(4, '0')}-${safe(item.label)}.${EXT[item.mime] ?? 'bin'}`;
    try {
      const res = await fetch(mediaUrl(item.id), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('unavailable');
      files[file] = [new Uint8Array(await res.arrayBuffer()), { level: 0 }];
      photos.push({ id: item.id, label: item.label, file, createdAt: item.createdAt });
    } catch {
      missing++;
      photos.push({ id: item.id, label: item.label, file: null, createdAt: item.createdAt });
    }
  }
  const at = new Date();
  // The PIN is a lock of this device, not data: only whether one is set.
  const { pin, ...deviceRest } = device;
  const data = {
    format: 'aplikaacja-account-export',
    v: 1,
    exportedAt: at.toISOString(),
    account: { email: me.email, displayName: me.displayName, role: me.role },
    settings,
    favorites: favorites.favorites,
    history: history.entries,
    preferredSymbols: preferred.items,
    usage: usage.days,
    device: { ...deviceRest, pinSet: pin !== null },
    photos,
  };
  files['dane.json'] = strToU8(JSON.stringify(data, null, 2));
  files['CZYTAJ.txt'] = strToU8(README(at.toLocaleDateString('pl-PL', { dateStyle: 'long' })));
  const zipped = zipSync(files, { level: 6 });
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    name: `aplikaacja-dane-${at.toISOString().slice(0, 10)}.zip`,
    missing,
  };
}
