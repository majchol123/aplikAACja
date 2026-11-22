import {
  obzToPackage,
  packageToObz,
  subtreePackage,
  symbolKey,
  type BoardChanges,
  type BoardPackage,
  type BoardTree,
  type MediaSaved,
  type ObzImport,
  type ObzPicture,
  type SymbolRef,
  type TemplateBoard,
} from '@relaacja/shared';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { api, ApiError } from '../api.ts';
import { decodePhoto, encodePhoto, fullCrop, PhotoError, renderCrop } from '../media/encode.ts';

/** Open Board files (PLAN §2.8): built and read in the browser, never on the server. */
const MAX_FILE = 50 * 1024 * 1024;
const MAX_UNZIPPED = 100 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const PICTURE_TYPES = new Set<ObzPicture['mime']>(['image/webp', 'image/png', 'image/jpeg']);

/** Shown to the person as is. */
export class FileProblem extends Error {}

function symbolsOf(pkg: BoardPackage): SymbolRef[] {
  const found = new Map<string, SymbolRef>();
  const walk = (board: TemplateBoard) => {
    for (const tile of board.tiles) {
      if (tile.symbol) found.set(symbolKey(tile.symbol), tile.symbol);
      if (tile.board) walk(tile.board);
    }
  };
  walk(pkg.board);
  if (pkg.tile?.symbol) found.set(symbolKey(pkg.tile.symbol), pkg.tile.symbol);
  return [...found.values()];
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

/** File name from a board name, without characters file systems refuse. */
export function fileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_').trim() || 'tablica';
  return `${safe}.obz`;
}

/**
 * Board `boardId` with its sub-boards as an .obz archive: pictures of ARASAAC and own
 * photos inside, the extra set by reference only. `resolve` gives each symbol's URL (as
 * on the boards). Pictures that cannot be fetched stay out; their tiles keep a reference.
 */
export async function exportBoardFile(
  tree: BoardTree,
  boardId: string,
  resolve: (symbol: SymbolRef) => string | null,
): Promise<{ blob: Blob; name: string; pictures: number; missing: number }> {
  const boards = new Map(tree.boards.map((b) => [b.id, b]));
  const opener = tree.boards.flatMap((b) => b.tiles).find((t) => t.targetBoardId === boardId);
  const built = subtreePackage(boards, boardId, opener ?? null);
  if (!built) throw new FileProblem('Tej tablicy już nie ma.');
  const pictures = new Map<string, ObzPicture>();
  let missing = 0;
  const wanted = symbolsOf(built.package).filter((s) => s.set !== 'extra');
  await pool(wanted, 6, async (symbol) => {
    const url = resolve(symbol);
    try {
      const res = url ? await fetch(url, { credentials: 'same-origin' }) : null;
      const mime = res?.headers.get('Content-Type')?.split(';')[0] as ObzPicture['mime'];
      if (!res?.ok || !PICTURE_TYPES.has(mime)) throw new Error('unavailable');
      pictures.set(symbolKey(symbol), { mime, data: new Uint8Array(await res.arrayBuffer()) });
    } catch {
      missing++;
    }
  });
  const files = packageToObz(built.package, pictures);
  const zippable: Zippable = {};
  for (const [path, content] of Object.entries(files)) {
    // Pictures are compressed already.
    zippable[path] = typeof content === 'string' ? strToU8(content) : [content, { level: 0 }];
  }
  const zipped = zipSync(zippable, { level: 6, mtime: new Date('2000-01-01') });
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }),
    name: fileName(built.package.name),
    pictures: pictures.size,
    missing,
  };
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** An .obz (ZIP) or .obf (JSON) file as a package; size and unpacked size are capped. */
export async function readBoardFile(file: File): Promise<ObzImport> {
  if (file.size > MAX_FILE) throw new FileProblem('Plik jest za duży (najwyżej 50 MB).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array>;
  if (bytes[0] === 0x7b || file.name.toLowerCase().endsWith('.obf')) {
    files = { [file.name.toLowerCase().endsWith('.obf') ? file.name : 'board.obf']: bytes };
  } else {
    let total = 0;
    let entries = 0;
    try {
      files = unzipSync(bytes, {
        filter: (entry) => {
          entries++;
          total += entry.originalSize;
          if (entries > MAX_ENTRIES || total > MAX_UNZIPPED) {
            throw new FileProblem('Plik rozpakowuje się do zbyt wielu danych.');
          }
          return !entry.name.endsWith('/');
        },
      });
    } catch (err) {
      if (err instanceof FileProblem) throw err;
      throw new FileProblem('To nie jest plik .obz ani .obf (Open Board Format).');
    }
  }
  try {
    return obzToPackage(files);
  } catch (err) {
    throw new FileProblem(err instanceof Error ? err.message : 'Nie udało się odczytać pliku.');
  }
}

/** A picture from a file as an own photo: whole, centred on a square, ≤ 512 px, re-encoded. */
async function asPhoto(data: Uint8Array, mime: string): Promise<Blob> {
  const bitmap = await decodePhoto(new Blob([data as Uint8Array<ArrayBuffer>], { type: mime }));
  const side = Math.max(bitmap.width, bitmap.height);
  const square = document.createElement('canvas');
  square.width = side;
  square.height = side;
  const g = square.getContext('2d');
  if (!g) throw new PhotoError('Ta przeglądarka nie potrafi przygotować zdjęcia.');
  g.drawImage(bitmap, (side - bitmap.width) / 2, (side - bitmap.height) / 2);
  bitmap.close();
  return encodePhoto(renderCrop(square, fullCrop(side, side), 512));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadPhoto(label: string, image: Blob): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.set('label', label);
    form.set('image', image, 'zdjecie');
    try {
      return (await api<MediaSaved>('/api/media', { method: 'POST', body: form })).media.id;
    } catch (err) {
      // Many photos at once can use up the write budget: wait for it to refill.
      if (err instanceof ApiError && err.code === 'rate_limited' && attempt < 20) {
        await wait(1500);
        continue;
      }
      throw err;
    }
  }
}

function withPhotos(pkg: BoardPackage, ids: ReadonlyMap<string, string>): BoardPackage {
  const map = (symbol: SymbolRef | null | undefined): SymbolRef | null => {
    if (symbol?.set !== 'own') return symbol ?? null;
    const id = ids.get(symbol.ref);
    return id ? { set: 'own', ref: id } : null;
  };
  const board = (b: TemplateBoard): TemplateBoard => ({
    ...b,
    tiles: b.tiles.map((t) => ({
      ...t,
      symbol: map(t.symbol),
      ...(t.board ? { board: board(t.board) } : {}),
    })),
  });
  return {
    ...pkg,
    ...(pkg.tile ? { tile: { ...pkg.tile, symbol: map(pkg.tile.symbol) } } : {}),
    board: board(pkg.board),
  };
}

/**
 * Uploads the file's photos (each re-encoded like a taken photo; one that fails is left
 * out), then places the package as a new folder on board `boardId`.
 */
export async function importBoardFile(
  imported: ObzImport,
  board: { id: string; rev: number },
  onProgress: (done: number, total: number) => void,
): Promise<{ changes: BoardChanges; skippedPhotos: number }> {
  const ids = new Map<string, string>();
  let skipped = 0;
  let done = 0;
  onProgress(0, imported.photos.length);
  for (const photo of imported.photos) {
    try {
      ids.set(photo.key, await uploadPhoto(photo.label, await asPhoto(photo.data, photo.mime)));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'quota_exceeded') throw err;
      skipped++;
    }
    onProgress(++done, imported.photos.length);
  }
  const changes = await api<BoardChanges>(`/api/boards/${board.id}/import`, {
    method: 'POST',
    json: { rev: board.rev, package: withPhotos(imported.package, ids) },
  });
  return { changes, skippedPhotos: skipped };
}
