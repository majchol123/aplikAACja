import { describe, expect, it } from 'vitest';
import { obzToPackage, packageToObz, subtreePackage, symbolKey } from './obf.ts';
import { restoreTree, type VaultDump } from './restore.ts';

declare const TextEncoder: new () => { encode(input: string): Uint8Array };
const encoder = new TextEncoder();

const HOME = 'a'.repeat(26);
const FOLDER = 'b'.repeat(26);
const PHOTO = 'p'.repeat(26);

/** The shape app/src/worker/lib/backup.ts dumpTables writes for a vault. */
const dump: VaultDump = {
  v: 1,
  kind: 'vault',
  at: 0,
  tables: {
    boards: {
      columns: ['id', 'name', 'parent_board_id', 'rows', 'cols', 'rev', 'created_at', 'updated_at'],
      rows: [
        [HOME, 'Start', null, 2, 3, 7, 0, 0],
        [FOLDER, 'Picie', HOME, 1, 2, 2, 0, 0],
      ],
    },
    tiles: {
      columns: [
        'id',
        'board_id',
        'row',
        'col',
        'kind',
        'target_board_id',
        'label',
        'label_position',
        'font_size',
        'color_role',
        'color_mode',
        'symbol_set',
        'symbol_ref',
        'created_at',
        'updated_at',
      ],
      rows: [
        [
          't1',
          HOME,
          0,
          1,
          'word',
          null,
          'mama',
          'top',
          'L',
          'person',
          'background',
          'own',
          PHOTO,
          0,
          0,
        ],
        [
          't2',
          HOME,
          0,
          0,
          'folder',
          FOLDER,
          'Picie',
          'bottom',
          'M',
          null,
          'border',
          'arasaac',
          '2462',
          0,
          0,
        ],
        [
          't3',
          FOLDER,
          0,
          0,
          'word',
          null,
          'sok',
          'bottom',
          'M',
          'noun',
          'border',
          null,
          null,
          0,
          0,
        ],
      ],
    },
    media: {
      columns: ['id', 'label', 'mime', 'width', 'height', 'bytes', 'sha256', 'created_at'],
      rows: [[PHOTO, 'Mama', 'image/webp', 64, 64, 3, 'x', 0]],
    },
    settings: { columns: ['key', 'value'], rows: [] },
  },
};

describe('restoring boards from a backup (PLAN §6)', () => {
  it('rebuilds the tree of GET /api/boards from the dumped tables', () => {
    const { tree, photos } = restoreTree(dump);
    expect(tree.homeId).toBe(HOME);
    const home = tree.boards.find((b) => b.id === HOME)!;
    expect(home).toMatchObject({ name: 'Start', parentId: null, rows: 2, cols: 3, rev: 7 });
    expect(home.tiles.find((t) => t.id === 't1')).toEqual({
      id: 't1',
      row: 0,
      col: 1,
      kind: 'word',
      targetBoardId: null,
      label: 'mama',
      labelPosition: 'top',
      fontSize: 'L',
      colorRole: 'person',
      colorMode: 'background',
      symbol: { set: 'own', ref: PHOTO },
    });
    expect(tree.boards.find((b) => b.id === FOLDER)!.tiles[0]!.symbol).toBeNull();
    expect(photos).toEqual([
      { id: PHOTO, label: 'Mama', mime: 'image/webp', width: 64, height: 64 },
    ]);
  });

  it('becomes an Open Board file that the app reads back, photo included', () => {
    const { tree } = restoreTree(dump);
    const built = subtreePackage(new Map(tree.boards.map((b) => [b.id, b])), HOME)!;
    expect(built.photoIds).toEqual([PHOTO]);
    const picture = { mime: 'image/webp' as const, data: new Uint8Array([1, 2, 3]) };
    const files = packageToObz(
      built.package,
      new Map([[symbolKey({ set: 'own', ref: PHOTO }), picture]]),
    );
    const back = obzToPackage(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? encoder.encode(v) : v]),
      ),
    );
    expect(back.package.name).toBe('Start');
    expect(back.package.board.tiles.map((t) => t.label)).toEqual(['Picie', 'mama']);
    expect(back.package.board.tiles[0]!.board!.tiles.map((t) => t.label)).toEqual(['sok']);
    expect(back.photos).toHaveLength(1);
    expect([...back.photos[0]!.data]).toEqual([1, 2, 3]);
  });

  it('refuses what is not a vault dump', () => {
    expect(() => restoreTree({ ...dump, kind: 'catalog' } as unknown as VaultDump)).toThrow(
      'not a vault backup',
    );
  });
});
