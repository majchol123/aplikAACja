import { z } from 'zod';
import {
  BOARD_LIMITS,
  type Board,
  type BoardPackage,
  type SymbolRef,
  type TemplateBoard,
  type TemplateTile,
  type Tile,
} from './boards.ts';
import { SHARE_LIMITS } from './share.ts';
import type { FitzgeraldRole } from './symbols.ts';

/**
 * Open Board Format (PLAN §2.8): a package as an .obz archive — manifest.json, one .obf
 * board per (sub)board and the pictures — and back. Pure functions over file contents;
 * zipping and fetching pictures is the caller's job. `ext_relaacja_*` fields make our own
 * export → import lossless; files from other AAC apps are read as far as they fit.
 */
export const OBF_FORMAT = 'open-board-0.1';

// --- a board package from a board tree ------------------------------------------------

/**
 * Board `rootId` with everything below it as a package (what sharing and files carry).
 * `opener` is the folder tile opening it, if any (its look travels along). `own` symbols
 * keep the photo IDs of the account; `photoIds` lists them.
 */
export function subtreePackage(
  boards: ReadonlyMap<string, Board>,
  rootId: string,
  opener?: Tile | null,
): { package: BoardPackage; boards: number; tiles: number; photoIds: string[] } | null {
  const root = boards.get(rootId);
  if (!root) return null;
  const photos = new Set<string>();
  const seen = new Set<string>();
  let tiles = 0;
  const build = (board: Board): TemplateBoard => {
    seen.add(board.id);
    return {
      rows: board.rows,
      cols: board.cols,
      tiles: [...board.tiles]
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .map((tile): TemplateTile => {
          tiles++;
          if (tile.symbol?.set === 'own') photos.add(tile.symbol.ref);
          const target = tile.targetBoardId ? boards.get(tile.targetBoardId) : undefined;
          return {
            row: tile.row,
            col: tile.col,
            kind: target && !seen.has(target.id) ? tile.kind : 'word',
            label: tile.label,
            labelPosition: tile.labelPosition,
            fontSize: tile.fontSize,
            colorRole: tile.colorRole,
            colorMode: tile.colorMode,
            symbol: tile.symbol,
            ...(tile.hidden ? { hidden: true } : {}),
            ...(tile.speech ? { speech: tile.speech } : {}),
            ...(target && !seen.has(target.id) ? { board: build(target) } : {}),
          };
        }),
    };
  };
  const board = build(root);
  if (opener?.symbol?.set === 'own') photos.add(opener.symbol.ref);
  return {
    package: {
      v: 1,
      name: root.name,
      ...(opener
        ? {
            tile: {
              labelPosition: opener.labelPosition,
              fontSize: opener.fontSize,
              colorRole: opener.colorRole,
              colorMode: opener.colorMode,
              symbol: opener.symbol,
            },
          }
        : {}),
      board,
    },
    boards: seen.size,
    tiles,
    photoIds: [...photos],
  };
}

// --- colours ----------------------------------------------------------------------------

type Rgb = [number, number, number];

/** Modified Fitzgerald Key as plain colours (the app's palette, PLAN §3.3). */
const ROLE_RGB: Record<FitzgeraldRole, { border: Rgb; background: Rgb }> = {
  person: { border: [250, 204, 21], background: [254, 240, 138] },
  noun: { border: [251, 146, 60], background: [254, 215, 170] },
  verb: { border: [34, 197, 94], background: [187, 247, 208] },
  descriptor: { border: [14, 165, 233], background: [186, 230, 253] },
  social: { border: [244, 114, 182], background: [251, 207, 232] },
  question: { border: [168, 85, 247], background: [233, 213, 255] },
  negation: { border: [239, 68, 68], background: [254, 202, 202] },
  misc: { border: [148, 163, 184], background: [226, 232, 240] },
};
const NEUTRAL_BORDER: Rgb = [203, 213, 225];
const WHITE: Rgb = [255, 255, 255];

const css = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/** `rgb()`, `rgba()` (blended onto white) or `#rgb`/`#rrggbb`; null otherwise. */
export function parseColor(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex?.[1]) {
    const h = hex[1];
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!fn) return null;
  const alpha = fn[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(fn[4])));
  return [fn[1], fn[2], fn[3]].map((c) =>
    Math.round(Math.min(255, Number(c)) * alpha + 255 * (1 - alpha)),
  ) as Rgb;
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The Fitzgerald role a foreign button's colours are closest to, if any is close. */
function guessRole(
  background: Rgb | null,
  border: Rgb | null,
): { role: FitzgeraldRole; mode: Tile['colorMode'] } | null {
  let best: { role: FitzgeraldRole; mode: Tile['colorMode']; d: number } | null = null;
  for (const [role, rgb] of Object.entries(ROLE_RGB) as [FitzgeraldRole, typeof ROLE_RGB.noun][]) {
    if (background && distance(background, WHITE) > 30) {
      const d = Math.min(distance(background, rgb.background), distance(background, rgb.border));
      if (!best || d < best.d) best = { role, mode: 'background', d };
    } else if (border) {
      const d = distance(border, rgb.border);
      if (!best || d < best.d) best = { role, mode: 'border', d };
    }
  }
  return best && best.d < 60 ? { role: best.role, mode: best.mode } : null;
}

// --- export --------------------------------------------------------------------------------

/** A picture going into the archive; keyed by `symbolKey`. */
export interface ObzPicture {
  mime: 'image/webp' | 'image/png' | 'image/jpeg';
  data: Uint8Array;
  width?: number;
  height?: number;
}

export const symbolKey = (symbol: SymbolRef) => `${symbol.set}:${symbol.ref}`;

const EXTENSION: Record<ObzPicture['mime'], string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

/** ARASAAC licence, required on every one of its pictures (PLAN §2.9). */
export const ARASAAC_LICENSE = {
  type: 'CC BY-NC-SA 4.0',
  copyright_notice_url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  source_url: 'https://arasaac.org',
  author_name: 'Sergio Palao',
  author_url: 'https://arasaac.org',
} as const;

/**
 * The archive's files: `manifest.json`, `boards/<n>.obf` (root first) and the given
 * pictures under `images/`. Symbols of the extra set are never copied: they travel as a
 * reference only (an app without the set shows the label). A symbol without a picture
 * still keeps its `ext_relaacja_symbol`, so importing the file here restores it.
 */
export function packageToObz(
  pkg: BoardPackage,
  pictures: ReadonlyMap<string, ObzPicture>,
): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  const boardPaths: Record<string, string> = {};
  const imagePaths: Record<string, string> = {};
  const imageEntries = new Map<string, Record<string, unknown>>();

  const imageFor = (symbol: SymbolRef): string => {
    const id = `${symbol.set}-${symbol.ref}`;
    if (imageEntries.has(id)) return id;
    const picture = symbol.set === 'extra' ? undefined : pictures.get(symbolKey(symbol));
    const entry: Record<string, unknown> = { id, ext_relaacja_symbol: symbol };
    if (picture) {
      const path = `images/${id}.${EXTENSION[picture.mime]}`;
      files[path] = picture.data;
      imagePaths[id] = path;
      entry.path = path;
      entry.content_type = picture.mime;
      if (picture.width) entry.width = picture.width;
      if (picture.height) entry.height = picture.height;
    } else if (symbol.set === 'extra') {
      entry.symbol = { set: 'relaacja-extra', filename: symbol.ref };
    }
    if (symbol.set === 'arasaac') {
      entry.license = ARASAAC_LICENSE;
      if (!picture) {
        entry.url = `https://static.arasaac.org/pictograms/${symbol.ref}/${symbol.ref}_500.png`;
        entry.content_type = 'image/png';
      }
    }
    imageEntries.set(id, entry);
    return id;
  };

  let next = 0;
  const writeBoard = (board: TemplateBoard, name: string): string => {
    const id = String(next++);
    const path = `boards/${id}.obf`;
    boardPaths[id] = path;
    const used = new Set<string>();
    const order: (string | null)[][] = Array.from({ length: board.rows }, () =>
      Array.from({ length: board.cols }, () => null),
    );
    const buttons = board.tiles.map((tile, i) => {
      const buttonId = `${id}-${i}`;
      const row = order[tile.row];
      if (row && tile.col < board.cols) row[tile.col] = buttonId;
      const role = tile.colorRole ? ROLE_RGB[tile.colorRole] : null;
      const filled = (tile.colorMode ?? 'border') === 'background';
      const button: Record<string, unknown> = {
        id: buttonId,
        label: tile.label,
        border_color: css(role ? role.border : NEUTRAL_BORDER),
        background_color: css(role && filled ? role.background : WHITE),
        ext_relaacja_label_position: tile.labelPosition ?? 'bottom',
        ext_relaacja_font_size: tile.fontSize ?? 'M',
        ext_relaacja_color_role: tile.colorRole ?? null,
        ext_relaacja_color_mode: tile.colorMode ?? 'border',
      };
      // Open Board's own fields: other apps hide the button and say its words too.
      if (tile.hidden) button.hidden = true;
      if (tile.speech) button.vocalization = tile.speech;
      if (tile.symbol) {
        const image = imageFor(tile.symbol);
        used.add(image);
        button.image_id = image;
      }
      if (tile.board) {
        const target = writeBoard(tile.board, tile.label);
        button.load_board = { id: target, name: tile.label, path: boardPaths[target] };
      }
      return button;
    });
    files[path] = JSON.stringify({
      format: OBF_FORMAT,
      id,
      locale: 'pl',
      name,
      ext_relaacja_package: 1,
      buttons,
      grid: { rows: board.rows, columns: board.cols, order },
      images: [...used].map((image) => imageEntries.get(image)),
      sounds: [],
    });
    return id;
  };

  writeBoard(pkg.board, pkg.name);
  const root = boardPaths['0'];
  // The root board also carries the look of the folder that opened it.
  if (pkg.tile && root) {
    const doc = JSON.parse(files[root] as string) as Record<string, unknown>;
    const { symbol, ...look } = pkg.tile;
    const folder: Record<string, unknown> = { ...look };
    if (symbol) {
      const image = imageFor(symbol);
      const images = doc.images as unknown[];
      if (!images.some((i) => (i as { id: string }).id === image)) {
        images.push(imageEntries.get(image));
      }
      folder.image_id = image;
    }
    doc.ext_relaacja_folder = folder;
    files[root] = JSON.stringify(doc);
  }
  files['manifest.json'] = JSON.stringify({
    format: OBF_FORMAT,
    root,
    paths: { boards: boardPaths, images: imagePaths, sounds: {} },
    ext_relaacja_package: 1,
  });
  return files;
}

// --- import ----------------------------------------------------------------------------------

const id = z.union([z.string(), z.number()]).transform(String);

const ImageSchema = z
  .object({
    id,
    data: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    content_type: z.string().optional(),
    ext_relaacja_symbol: z.unknown().optional(),
  })
  .loose();

const ButtonSchema = z
  .object({
    id,
    label: z.string().optional(),
    vocalization: z.string().optional(),
    image_id: id.optional(),
    background_color: z.string().optional(),
    border_color: z.string().optional(),
    load_board: z.object({ id: id.optional(), path: z.string().optional() }).loose().optional(),
    hidden: z.boolean().optional(),
    ext_relaacja_label_position: z.enum(['top', 'bottom']).optional(),
    ext_relaacja_font_size: z.enum(['S', 'M', 'L', 'XL']).optional(),
    ext_relaacja_color_role: z
      .enum(['person', 'noun', 'verb', 'descriptor', 'social', 'question', 'negation', 'misc'])
      .nullable()
      .optional(),
    ext_relaacja_color_mode: z.enum(['background', 'border']).optional(),
  })
  .loose();

const ObfSchema = z
  .object({
    id: id.optional(),
    name: z.string().optional(),
    buttons: z.array(z.unknown()).max(10_000),
    grid: z
      .object({
        rows: z.number().int().min(1),
        columns: z.number().int().min(1),
        order: z.array(z.array(z.union([id, z.null()]))),
      })
      .loose(),
    images: z.array(z.unknown()).max(10_000).optional(),
    ext_relaacja_folder: z.unknown().optional(),
  })
  .loose();
type Obf = z.infer<typeof ObfSchema>;

const ManifestSchema = z
  .object({
    root: z.string(),
    paths: z
      .object({ boards: z.record(z.string(), z.string()).optional() })
      .loose()
      .optional(),
  })
  .loose();

const SymbolExtSchema = z.discriminatedUnion('set', [
  z.object({ set: z.literal('arasaac'), ref: z.string().regex(/^(0|[1-9][0-9]{0,9})$/) }),
  z.object({ set: z.literal('extra'), ref: z.string().regex(/^(0|[1-9][0-9]{0,9})$/) }),
  z.object({ set: z.literal('own'), ref: z.string().min(1).max(64) }),
]);

const FolderExtSchema = z
  .object({
    labelPosition: z.enum(['top', 'bottom']),
    fontSize: z.enum(['S', 'M', 'L', 'XL']),
    colorRole: ButtonSchema.shape.ext_relaacja_color_role.unwrap(),
    colorMode: z.enum(['background', 'border']),
    image_id: id.optional(),
  })
  .loose();

/** A picture of the file that becomes an own photo (re-encoded by the browser first). */
export interface ImportedPhoto {
  key: string;
  label: string;
  mime: string;
  data: Uint8Array;
}

export interface ObzImport {
  package: BoardPackage;
  /** `own` symbols of the package point at these by key. */
  photos: ImportedPhoto[];
  /** What was left out or changed, in Polish, for the person importing. */
  warnings: string[];
}

// Present in browsers, Workers and Node; the shared package compiles without DOM types.
declare const TextDecoder: new () => { decode(input: Uint8Array): string };
declare function atob(data: string): string;

const PICTURE_TYPES = /^image\/(png|jpeg|webp|gif|bmp)$/;
const ARASAAC_URL = /arasaac\.org\/(?:api\/)?pictograms\/(\d{1,10})(?:[/_?]|$)/;
const decoder = new TextDecoder();

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cs}\u2028\u2029]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? [...text].slice(0, max).join('') : null;
}

function dataUri(value: string): { mime: string; data: Uint8Array } | null {
  const [, mime, base64] = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value) ?? [];
  if (!mime || !base64) return null;
  const binary = atob(base64.replace(/\s/g, ''));
  return { mime, data: Uint8Array.from(binary, (c) => c.charCodeAt(0)) };
}

/**
 * Temporary ID of the n-th photo of an imported file, shaped like a media ID (so the
 * package validates); replaced by the real ID once the photo is uploaded.
 */
const photoKey = (n: number) =>
  `zz${String(n).replace(/\d/g, (d) => 'abcdefghij'.charAt(Number(d)))}`.padEnd(26, 'z');

/** Archive path relative to the manifest: no leading "./" or "/". */
const normal = (path: string) => path.replace(/^\.?\//, '');

/**
 * Reads an .obz (its files) or a single .obf (`{'board.obf': bytes}`) into a package.
 * The archive's root board becomes the package; boards linked a second time (or in a
 * loop) become plain words, and everything beyond the package limits is left out with a
 * warning. Throws `Error` with a Polish message when nothing usable is found.
 */
export function obzToPackage(files: Readonly<Record<string, Uint8Array>>): ObzImport {
  const warnings = new Set<string>();
  const text = (path: string): string | null => {
    const bytes = files[normal(path)];
    return bytes ? decoder.decode(bytes) : null;
  };
  const parseBoard = (path: string): Obf | null => {
    try {
      const parsed = ObfSchema.safeParse(JSON.parse(text(path) ?? 'null'));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  let rootPath: string | undefined;
  let boardPaths: Record<string, string> = {};
  const manifestText = text('manifest.json');
  if (manifestText) {
    try {
      const manifest = ManifestSchema.parse(JSON.parse(manifestText));
      rootPath = normal(manifest.root);
      boardPaths = Object.fromEntries(
        Object.entries(manifest.paths?.boards ?? {}).map(([k, v]) => [k, normal(v)]),
      );
    } catch {
      throw new Error('Plik nie jest prawidłowym pakietem tablic (.obz): błędny manifest.');
    }
  } else {
    rootPath = Object.keys(files).find((name) => name.toLowerCase().endsWith('.obf'));
  }
  const root = rootPath ? parseBoard(rootPath) : null;
  if (!root || !rootPath) throw new Error('W pliku nie ma tablicy w formacie Open Board.');

  const photos = new Map<string, ImportedPhoto>();
  const visited = new Set<string>([rootPath]);
  let boards = 0;
  let tiles = 0;

  const convert = (doc: Obf, depth: number): TemplateBoard => {
    boards++;
    const rows = Math.min(doc.grid.rows, BOARD_LIMITS.maxRows);
    const cols = Math.min(doc.grid.columns, BOARD_LIMITS.maxCols);
    if (rows < doc.grid.rows || cols < doc.grid.columns) {
      warnings.add(
        `Siatka większa niż ${BOARD_LIMITS.maxRows}×${BOARD_LIMITS.maxCols} została przycięta.`,
      );
    }
    const buttons = new Map<string, z.infer<typeof ButtonSchema>>();
    for (const raw of doc.buttons) {
      const b = ButtonSchema.safeParse(raw);
      if (b.success) buttons.set(b.data.id, b.data);
    }
    const images = new Map<string, z.infer<typeof ImageSchema>>();
    for (const raw of doc.images ?? []) {
      const image = ImageSchema.safeParse(raw);
      if (image.success) images.set(image.data.id, image.data);
    }
    const out: TemplateTile[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const buttonId = doc.grid.order[r]?.[c];
        const button = buttonId == null ? undefined : buttons.get(String(buttonId));
        if (!button) continue;
        if (tiles >= SHARE_LIMITS.maxTiles) {
          warnings.add(`Wczytano najwyżej ${SHARE_LIMITS.maxTiles} kafelków.`);
          continue;
        }
        const label =
          cleanText(button.label, BOARD_LIMITS.labelMax) ??
          cleanText(button.vocalization, BOARD_LIMITS.labelMax);
        if (!label) {
          warnings.add('Pominięto przyciski bez napisu.');
          continue;
        }
        tiles++;
        const tile: TemplateTile = { row: r, col: c, kind: 'word', label };
        if (button.hidden) tile.hidden = true;
        // Words of its own (Open Board's vocalization), unless they are just the label.
        const speech = cleanText(button.vocalization, BOARD_LIMITS.speechMax);
        if (speech && speech !== label) tile.speech = speech;
        if (button.ext_relaacja_label_position)
          tile.labelPosition = button.ext_relaacja_label_position;
        if (button.ext_relaacja_font_size) tile.fontSize = button.ext_relaacja_font_size;
        if (button.ext_relaacja_color_role !== undefined) {
          tile.colorRole = button.ext_relaacja_color_role;
          tile.colorMode = button.ext_relaacja_color_mode ?? 'border';
        } else {
          const guess = guessRole(
            parseColor(button.background_color),
            parseColor(button.border_color),
          );
          if (guess) {
            tile.colorRole = guess.role;
            tile.colorMode = guess.mode;
          }
        }
        const image = button.image_id ? images.get(button.image_id) : undefined;
        tile.symbol = image ? pictureOf(image, label) : null;
        const link = button.load_board;
        if (link) {
          const path = link.path ? normal(link.path) : link.id ? boardPaths[link.id] : undefined;
          const target = path && !visited.has(path) ? parseBoard(path) : null;
          if (path && target && depth < BOARD_LIMITS.maxDepth && boards < SHARE_LIMITS.maxBoards) {
            visited.add(path);
            tile.kind = 'folder';
            tile.board = convert(target, depth + 1);
          } else if (path && visited.has(path)) {
            warnings.add(
              'Odnośniki do tablic, które już są w pakiecie, zostały zwykłymi kafelkami.',
            );
          } else if (path) {
            warnings.add('Część folderów pominięto (za głęboko, za dużo tablic albo brak pliku).');
          }
        }
        out.push(tile);
      }
    }
    return { rows, cols, tiles: out };
  };

  const pictureOf = (image: z.infer<typeof ImageSchema>, label: string): SymbolRef | null => {
    const ext = SymbolExtSchema.safeParse(image.ext_relaacja_symbol);
    if (ext.success && ext.data.set !== 'own') return ext.data;
    const inArchive = image.path ? files[normal(image.path)] : undefined;
    const bytes = image.data
      ? dataUri(image.data)
      : inArchive
        ? { mime: image.content_type ?? '', data: inArchive }
        : null;
    if (bytes && PICTURE_TYPES.test(bytes.mime)) {
      const key = photoKey(photos.size);
      const existing = [...photos.values()].find((p) => p.data === bytes.data);
      if (existing) return { set: 'own', ref: existing.key };
      if (photos.size >= SHARE_LIMITS.maxPhotos) {
        warnings.add(`Wczytano najwyżej ${SHARE_LIMITS.maxPhotos} zdjęć.`);
        return null;
      }
      photos.set(key, { key, label, mime: bytes.mime, data: bytes.data });
      return { set: 'own', ref: key };
    }
    const arasaac = image.url ? ARASAAC_URL.exec(image.url) : null;
    if (arasaac) return { set: 'arasaac', ref: String(Number(arasaac[1])) };
    if (bytes || image.url) warnings.add('Obrazki w nieobsługiwanym formacie zostały pominięte.');
    return null;
  };

  const board = convert(root, 0);
  const name = cleanText(root.name, BOARD_LIMITS.labelMax) ?? 'Tablica z pliku';
  const folder = FolderExtSchema.safeParse(root.ext_relaacja_folder);
  let folderSymbol: SymbolRef | null = null;
  if (folder.success && folder.data.image_id !== undefined) {
    const image = (root.images ?? [])
      .map((raw) => ImageSchema.safeParse(raw).data)
      .find((entry) => entry?.id === folder.data.image_id);
    if (image) folderSymbol = pictureOf(image, name);
  }
  const pkg: BoardPackage = {
    v: 1,
    name,
    ...(folder.success
      ? {
          tile: {
            labelPosition: folder.data.labelPosition,
            fontSize: folder.data.fontSize,
            colorRole: folder.data.colorRole,
            colorMode: folder.data.colorMode,
            symbol: folderSymbol,
          },
        }
      : {}),
    board,
  };
  return { package: pkg, photos: [...photos.values()], warnings: [...warnings] };
}
