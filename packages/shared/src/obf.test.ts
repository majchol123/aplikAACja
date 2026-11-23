import { describe, expect, it } from 'vitest';
import starter from '../../../templates/starter.json' with { type: 'json' };
import {
  BoardPackageSchema,
  packageTree,
  TemplateSchema,
  type Board,
  type BoardPackage,
} from './boards.ts';
import {
  obzToPackage,
  packageToObz,
  parseColor,
  subtreePackage,
  symbolKey,
  type ObzPicture,
} from './obf.ts';

// Runtime globals the shared package compiles without (no DOM types).
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare function btoa(data: string): string;

const encoder = new TextEncoder();
const bytes = (files: Record<string, string | Uint8Array>) =>
  Object.fromEntries(
    Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? encoder.encode(v) : v]),
  );

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** Home → "Jedzenie" (photo "zupa", extra-set "chleb") → "Owoce" (ARASAAC "jabłko"). */
const pkg: BoardPackage = BoardPackageSchema.parse({
  v: 1,
  name: 'Jedzenie',
  tile: {
    labelPosition: 'top',
    fontSize: 'L',
    colorRole: 'noun',
    colorMode: 'background',
    symbol: { set: 'arasaac', ref: '2349' },
  },
  board: {
    rows: 2,
    cols: 3,
    tiles: [
      {
        row: 0,
        col: 0,
        kind: 'word',
        label: 'zupa',
        labelPosition: 'bottom',
        fontSize: 'M',
        colorRole: null,
        colorMode: 'border',
        symbol: { set: 'own', ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
      },
      {
        row: 0,
        col: 2,
        kind: 'word',
        label: 'chleb',
        labelPosition: 'bottom',
        fontSize: 'S',
        colorRole: 'noun',
        colorMode: 'border',
        symbol: { set: 'extra', ref: '17' },
      },
      {
        row: 1,
        col: 1,
        kind: 'folder',
        label: 'Owoce',
        labelPosition: 'bottom',
        fontSize: 'XL',
        colorRole: 'misc',
        colorMode: 'background',
        symbol: null,
        board: {
          rows: 1,
          cols: 1,
          tiles: [
            {
              row: 0,
              col: 0,
              kind: 'word',
              label: 'jabłko',
              labelPosition: 'bottom',
              fontSize: 'M',
              colorRole: 'noun',
              colorMode: 'border',
              symbol: { set: 'arasaac', ref: '2462' },
            },
          ],
        },
      },
    ],
  },
});

describe('board packages', () => {
  it('a subtree of a board tree is a package; boards linked twice become words', () => {
    const tree = packageTree(pkg);
    const boards = new Map<string, Board>(tree.boards.map((b) => [b.id, b]));
    const again = subtreePackage(boards, tree.homeId!, null);
    expect(again?.package.board).toEqual(pkg.board);
    expect(again).toMatchObject({ boards: 2, tiles: 4, photoIds: ['aaaaaaaaaaaaaaaaaaaaaaaaaa'] });

    // A folder pointing back at the root (a loop) is cut.
    const home = boards.get(tree.homeId!)!;
    const fruit = boards.get(home.tiles[2]!.targetBoardId!)!;
    fruit.tiles.push({ ...home.tiles[2]!, id: 'loop', row: 0, col: 0, targetBoardId: home.id });
    const cut = subtreePackage(boards, home.id, null)!;
    expect(cut.boards).toBe(2);
    expect(cut.package.board.tiles[2]!.board!.tiles.at(-1)).toMatchObject({ kind: 'word' });
  });
});

describe('Open Board Format', () => {
  const pictures = new Map<string, ObzPicture>([
    [
      symbolKey({ set: 'own', ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' }),
      { mime: 'image/png', data: PNG },
    ],
    [symbolKey({ set: 'arasaac', ref: '2462' }), { mime: 'image/webp', data: PNG }],
    // Never written, even if a caller passes it.
    [symbolKey({ set: 'extra', ref: '17' }), { mime: 'image/webp', data: PNG }],
  ]);

  it('exports boards, pictures and licences; the extra set travels as a reference only', () => {
    const files = packageToObz(pkg, pictures);
    expect(Object.keys(files).sort()).toEqual([
      'boards/0.obf',
      'boards/1.obf',
      'images/arasaac-2462.webp',
      'images/own-aaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      'manifest.json',
    ]);
    const manifest = JSON.parse(files['manifest.json'] as string);
    expect(manifest).toMatchObject({ format: 'open-board-0.1', root: 'boards/0.obf' });
    const root = JSON.parse(files['boards/0.obf'] as string);
    expect(root.grid).toEqual({
      rows: 2,
      columns: 3,
      order: [
        ['0-0', null, '0-1'],
        [null, '0-2', null],
      ],
    });
    expect(root.buttons[2]).toMatchObject({
      label: 'Owoce',
      load_board: { id: '1', path: 'boards/1.obf' },
      background_color: 'rgb(226, 232, 240)',
    });
    const extra = root.images.find((i: { id: string }) => i.id === 'extra-17');
    expect(extra).toEqual({
      id: 'extra-17',
      ext_aplikaacja_symbol: { set: 'extra', ref: '17' },
      symbol: { set: 'aplikaacja-extra', filename: '17' },
    });
    // The folder picture of the package has no file here: a URL to ARASAAC instead.
    const folderPicture = root.images.find((i: { id: string }) => i.id === 'arasaac-2349');
    expect(folderPicture).toMatchObject({
      url: 'https://static.arasaac.org/pictograms/2349/2349_500.png',
      license: { author_name: 'Sergio Palao', type: 'CC BY-NC-SA 4.0' },
    });
  });

  it('the grid only names cells inside it; a tile position never reaches a prototype', () => {
    const word = pkg.board.tiles[0]!;
    // Positions a caller might pass around the types: none may write outside the grid.
    const odd = [-1, 3, 1.5, '__proto__', 'constructor'] as unknown as number[];
    const board = {
      rows: 1,
      cols: 3,
      tiles: [
        { ...word, row: 0, col: 1 },
        ...odd.map((col) => ({ ...word, row: 0, col })),
        ...odd.map((row) => ({ ...word, row, col: 0 })),
      ],
    };
    const files = packageToObz({ ...pkg, board }, pictures);
    const order: unknown = JSON.parse(files['boards/0.obf'] as string).grid.order;
    expect(order).toEqual([[null, '0-0', null]]);
    expect(Object.prototype).not.toHaveProperty('0');
    expect(Array.prototype).not.toHaveProperty('0');
  });

  it('our own export comes back unchanged (photos by key)', () => {
    const back = obzToPackage(bytes(packageToObz(pkg, pictures)));
    expect(back.warnings).toEqual([]);
    const key = back.photos[0]!.key;
    expect(back.photos).toEqual([{ key, label: 'zupa', mime: 'image/png', data: PNG }]);
    const expected = JSON.parse(JSON.stringify(pkg)) as BoardPackage;
    expected.board.tiles[0]!.symbol = { set: 'own', ref: key };
    expect(back.package).toEqual(expected);
    expect(BoardPackageSchema.safeParse(back.package).error?.issues ?? []).toEqual([]);
  });

  it('files saved before the rename (ext_relaacja_*) read the same', () => {
    const files = packageToObz(pkg, pictures);
    const old = Object.fromEntries(
      Object.entries(files).map(([k, v]) => [
        k,
        typeof v === 'string' ? v.replaceAll('"ext_aplikaacja_', '"ext_relaacja_') : v,
      ]),
    );
    expect(old['boards/0.obf']).toContain('"ext_relaacja_folder"');
    expect(old['boards/0.obf']).not.toContain('ext_aplikaacja_');
    const now = obzToPackage(bytes(files));
    const back = obzToPackage(bytes(old));
    expect(back.warnings).toEqual([]);
    expect(back.package).toEqual(now.package);
    expect(back.photos).toEqual(now.photos);
  });

  it('a tile’s own words travel as Open Board’s vocalization', () => {
    const start: BoardPackage = {
      v: 1,
      name: 'Start',
      board: {
        rows: 1,
        cols: 2,
        tiles: [
          { row: 0, col: 0, kind: 'word', label: 'pić', speech: 'Chcę się napić' },
          { row: 0, col: 1, kind: 'word', label: 'jeść' },
        ],
      },
    };
    const files = packageToObz(start, new Map());
    const root = JSON.parse(files['boards/0.obf'] as string) as {
      buttons: { vocalization?: string }[];
    };
    expect(root.buttons.map((b) => b.vocalization)).toEqual(['Chcę się napić', undefined]);
    const back = obzToPackage(bytes(files));
    expect(back.package.board.tiles.map((t) => [t.label, t.speech])).toEqual([
      ['pić', 'Chcę się napić'],
      ['jeść', undefined],
    ]);
  });

  it('hidden tiles stay hidden, with Open Board’s own field', () => {
    const start: BoardPackage = {
      v: 1,
      name: 'Start',
      board: {
        rows: 1,
        cols: 2,
        tiles: [
          { row: 0, col: 0, kind: 'word', label: 'tak', hidden: true },
          { row: 0, col: 1, kind: 'word', label: 'nie' },
        ],
      },
    };
    const files = packageToObz(start, new Map());
    const root = JSON.parse(files['boards/0.obf'] as string) as { buttons: { hidden?: true }[] };
    expect(root.buttons.map((b) => b.hidden)).toEqual([true, undefined]);
    const back = obzToPackage(bytes(files));
    expect(back.package.board.tiles.map((t) => [t.label, t.hidden])).toEqual([
      ['tak', true],
      ['nie', undefined],
    ]);
  });

  it('the whole starter template survives the round trip', () => {
    const template = TemplateSchema.parse(starter);
    const start: BoardPackage = { v: 1, name: template.name, board: template.board };
    const back = obzToPackage(bytes(packageToObz(start, new Map())));
    expect(back.warnings).toEqual([]);
    const tiles = (b: BoardPackage['board']): number =>
      b.tiles.reduce((n, t) => n + 1 + (t.board ? tiles(t.board) : 0), 0);
    expect(tiles(back.package.board)).toBe(tiles(start.board));
    expect(back.package.board.tiles.map((t) => t.label)).toEqual(
      start.board.tiles.map((t) => t.label),
    );
  });

  it('reads boards from other apps as far as they fit', () => {
    const png = `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`;
    const home = {
      format: 'open-board-0.1',
      id: 1,
      name: '  Moja   tablica ',
      buttons: [
        { id: 1, label: 'happy', image_id: 10, background_color: 'rgb(255, 220, 160)' },
        { id: 2, label: 'drinks', load_board: { path: 'b/2.obf' } },
        { id: 3, label: '', vocalization: 'hello there' },
        { id: 4, label: '' },
        { id: 5, label: 'pic', image_id: 11 },
        { id: 6, label: 'weird', image_id: 12 },
      ],
      grid: {
        rows: 41,
        columns: 2,
        order: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      },
      images: [
        { id: 10, url: 'https://static.arasaac.org/pictograms/2462/2462_300.png' },
        { id: 11, data: png, content_type: 'image/png' },
        { id: 12, data: 'data:image/svg+xml;base64,PHN2Zz4=' },
      ],
    };
    const drinks = {
      format: 'open-board-0.1',
      id: '2',
      name: 'Drinks',
      buttons: [{ id: 'x', label: 'home', load_board: { path: 'b/1.obf' } }],
      grid: { rows: 1, columns: 1, order: [['x']] },
    };
    const files = bytes({
      'manifest.json': JSON.stringify({ format: 'open-board-0.1', root: './b/1.obf' }),
      'b/1.obf': JSON.stringify(home),
      'b/2.obf': JSON.stringify(drinks),
    });
    const result = obzToPackage(files);
    expect(result.package.name).toBe('Moja tablica');
    expect(result.package.board.rows).toBe(40);
    expect(result.package.board.tiles.map((t) => [t.row, t.col, t.label, t.kind])).toEqual([
      [0, 0, 'happy', 'word'],
      [0, 1, 'drinks', 'folder'],
      [1, 0, 'hello there', 'word'],
      [2, 0, 'pic', 'word'],
      [2, 1, 'weird', 'word'],
    ]);
    const [happy, drink, , pic, weird] = result.package.board.tiles;
    expect(happy).toMatchObject({
      symbol: { set: 'arasaac', ref: '2462' },
      colorRole: 'noun',
      colorMode: 'background',
    });
    expect(drink!.board!.tiles).toEqual([expect.objectContaining({ label: 'home', kind: 'word' })]);
    expect(pic!.symbol).toEqual({ set: 'own', ref: result.photos[0]!.key });
    expect(result.photos[0]).toMatchObject({ label: 'pic', mime: 'image/png' });
    expect(weird!.symbol).toBeNull();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('przycięta'),
        expect.stringContaining('bez napisu'),
        expect.stringContaining('już są w pakiecie'),
        expect.stringContaining('nieobsługiwanym formacie'),
      ]),
    );
    expect(BoardPackageSchema.safeParse(result.package).error?.issues ?? []).toEqual([]);
  });

  it('a single .obf works without a manifest; junk is refused in Polish', () => {
    const one = bytes({
      'tablica.obf': JSON.stringify({
        name: 'Jedna',
        buttons: [{ id: 'a', label: 'tak' }],
        grid: { rows: 1, columns: 1, order: [['a']] },
      }),
    });
    expect(obzToPackage(one).package.board.tiles).toHaveLength(1);
    expect(() => obzToPackage(bytes({ 'readme.txt': 'hi' }))).toThrow(/Open Board/);
    expect(() => obzToPackage(bytes({ 'manifest.json': '{' }))).toThrow(/manifest/);
  });

  it('parses CSS colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#FA9A3C')).toEqual([250, 154, 60]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([128, 128, 128]);
    expect(parseColor('blue')).toBeNull();
  });
});
