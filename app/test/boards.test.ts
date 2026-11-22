import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { BOARD_LIMITS, type Board, type BoardChanges, type BoardTree } from '@relaacja/shared';
import { describe, expect, it } from 'vitest';
import { BoardStore } from '../src/worker/vault/boards.ts';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

type Api = ReturnType<typeof apiAs>;

async function setup(opts: { extraSet?: boolean } = {}) {
  const { call } = makeApp();
  const user = await insertUser(opts);
  const api = apiAs(call, await sessionCookie(user.id));
  return { api, call, user };
}

async function tree(api: Api): Promise<BoardTree> {
  const res = await api<BoardTree>('GET', '/api/boards');
  expect(res.status).toBe(200);
  return res.body;
}

function find(tree: BoardTree, id: string): Board {
  const board = tree.boards.find((b) => b.id === id);
  if (!board) throw new Error(`board ${id} missing`);
  return board;
}

function changed(res: { body: BoardChanges }, id: string): Board {
  const board = res.body.boards.find((b) => b.id === id);
  if (!board) throw new Error(`board ${id} not in the answer`);
  return board;
}

async function integrity(userId: string): Promise<string[]> {
  return runInDurableObject(vaultFor(env, userId), (_i: UserVault, state) =>
    new BoardStore(state.storage).integrity(),
  );
}

async function home(api: Api, rows = 4, cols = 5): Promise<Board> {
  const res = await api<BoardChanges>('POST', '/api/boards/home', { name: 'Start', rows, cols });
  expect(res.status).toBe(201);
  return res.body.boards[0]!;
}

/** Adds a tile and returns the updated board plus the new tile's ID. */
async function addTile(
  api: Api,
  board: Board,
  tile: Record<string, unknown> & { row: number; col: number; label: string },
) {
  const res = await api<BoardChanges>('POST', `/api/boards/${board.id}/tiles`, {
    rev: board.rev,
    kind: 'word',
    ...tile,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const updated = changed(res, board.id);
  const created = updated.tiles.find((t) => t.row === tile.row && t.col === tile.col)!;
  const child = created.targetBoardId ? changed(res, created.targetBoardId) : undefined;
  return { board: updated, tile: created, child };
}

describe('board tree', () => {
  it('starts empty, creates the home board once, and answers 304 for a known ETag', async () => {
    const { api } = await setup();
    const empty = await api<BoardTree>('GET', '/api/boards');
    expect(empty.body).toEqual({ homeId: null, boards: [] });
    const etag = empty.res.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{16}\.0"$/);
    expect(empty.res.headers.get('Cache-Control')).toBe('no-store');

    const board = await home(api);
    expect(board).toEqual({
      id: expect.stringMatching(/^[a-z2-7]{26}$/),
      name: 'Start',
      parentId: null,
      rows: 4,
      cols: 5,
      rev: 1,
      tiles: [],
    });
    const again = await api('POST', '/api/boards/home', { name: 'Start', rows: 4, cols: 5 });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'already_initialized' });

    const stale = await api('GET', '/api/boards', undefined, { 'If-None-Match': etag });
    expect(stale.status).toBe(200);
    const current = stale.res.headers.get('ETag')!;
    expect(current).not.toBe(etag);
    for (const header of [current, current.slice(2), `"x", ${current}`, '*']) {
      const cached = await api('GET', '/api/boards', undefined, { 'If-None-Match': header });
      expect(cached.status, header).toBe(304);
      expect(cached.res.headers.get('ETag')).toBe(current);
    }
  });

  it('builds Jedzenie → Śniadanie → chleb (PLAN F2 acceptance)', async () => {
    const { api, user } = await setup();
    let start = await home(api);
    const jedzenie = await addTile(api, start, {
      row: 0,
      col: 0,
      kind: 'folder',
      label: 'Jedzenie',
      symbol: { set: 'arasaac', ref: '4610' },
      colorRole: 'noun',
    });
    start = jedzenie.board;
    expect(start.rev).toBe(2);
    expect(jedzenie.child).toMatchObject({
      name: 'Jedzenie',
      parentId: start.id,
      rows: 4,
      cols: 5,
    });
    expect(jedzenie.child!.rev).toBe(1);

    const sniadanie = await addTile(api, jedzenie.child!, {
      row: 1,
      col: 2,
      kind: 'folder',
      label: 'Śniadanie',
      folder: { rows: 2, cols: 3 },
    });
    const chleb = await addTile(api, sniadanie.child!, {
      row: 1,
      col: 2,
      label: 'chleb',
      symbol: { set: 'arasaac', ref: '2494' },
      colorRole: 'noun',
      colorMode: 'background',
      fontSize: 'XL',
      labelPosition: 'top',
    });
    expect(chleb.tile).toEqual({
      id: expect.any(String),
      row: 1,
      col: 2,
      kind: 'word',
      targetBoardId: null,
      label: 'chleb',
      labelPosition: 'top',
      fontSize: 'XL',
      colorRole: 'noun',
      colorMode: 'background',
      symbol: { set: 'arasaac', ref: '2494' },
    });

    const t = await tree(api);
    expect(t.homeId).toBe(start.id);
    expect(t.boards).toHaveLength(3);
    const folder = find(t, start.id).tiles[0]!;
    expect(folder).toMatchObject({ kind: 'folder', label: 'Jedzenie', colorMode: 'border' });
    const breakfast = find(t, folder.targetBoardId!).tiles[0]!;
    expect(find(t, breakfast.targetBoardId!)).toMatchObject({
      name: 'Śniadanie',
      rows: 2,
      cols: 3,
      tiles: [expect.objectContaining({ label: 'chleb' })],
    });
    expect(await integrity(user.id)).toEqual([]);
  });

  it('refuses stale revisions (two parent devices at once)', async () => {
    const { api } = await setup();
    const board = await home(api);
    const first = await addTile(api, board, { row: 0, col: 0, label: 'tak' });
    // Second device still holds rev 1.
    const late = await api('POST', `/api/boards/${board.id}/tiles`, {
      rev: 1,
      row: 0,
      col: 1,
      kind: 'word',
      label: 'nie',
    });
    expect(late.status).toBe(409);
    expect(late.body).toEqual({ error: 'conflict' });
    const rename = await api('PATCH', `/api/tiles/${first.tile.id}`, { rev: 1, label: 'Tak!' });
    expect(rename.status).toBe(409);
    expect(find(await tree(api), board.id).tiles.map((t) => t.label)).toEqual(['tak']);
  });

  it('validates cells, grids and input', async () => {
    const { api } = await setup();
    let board = await home(api, 2, 3);
    board = (await addTile(api, board, { row: 1, col: 2, label: 'mama' })).board;
    const post = (body: Record<string, unknown>) =>
      api('POST', `/api/boards/${board.id}/tiles`, { rev: board.rev, kind: 'word', ...body });

    expect((await post({ row: 1, col: 2, label: 'tata' })).body).toEqual({
      error: 'cell_occupied',
    });
    expect((await post({ row: 2, col: 0, label: 'tata' })).body).toEqual({
      error: 'out_of_bounds',
    });
    for (const bad of [
      { row: 0, col: 0, label: '' },
      { row: 0, col: 0, label: '   ' },
      { row: 0, col: 0, label: 'a\u0000b' },
      { row: 0, col: 0, label: 'x'.repeat(BOARD_LIMITS.labelMax + 1) },
      { row: -1, col: 0, label: 'x' },
      { row: 0.5, col: 0, label: 'x' },
      { row: 0, col: 0, label: 'x', kind: 'link' },
      { row: 0, col: 0, label: 'x', folder: { rows: 2, cols: 2 } },
      { row: 0, col: 0, label: 'x', symbol: { set: 'arasaac', ref: '01' } },
      { row: 0, col: 0, label: 'x', symbol: { set: 'arasaac', ref: '../1' } },
      { row: 0, col: 0, label: 'x', symbol: { set: 'own', ref: '1' } },
      { row: 0, col: 0, label: 'x', symbol: { set: 'pcs', ref: '1' } },
      { row: 0, col: 0, label: 'x', colorRole: 'red' },
      { row: 0, col: 0, label: 'x', boardId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ]) {
      const res = await post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Trimmed and NFC-normalized (decomposed accents from some keyboards).
    const trimmed = await post({ row: 0, col: 0, label: '  Czes\u0301c\u0301  ' });
    expect(trimmed.status).toBe(201);
    expect(changed(trimmed as { body: BoardChanges }, board.id).tiles[0]!.label).toBe('Cześć');

    const nothing = await api('PATCH', `/api/boards/${board.id}`, { rev: 3 });
    expect(nothing.status).toBe(400);
  });

  it('only accepts own photos that exist and extra symbols with the grant', async () => {
    const { api } = await setup();
    const board = await home(api);
    const own = await api('POST', `/api/boards/${board.id}/tiles`, {
      rev: 1,
      row: 0,
      col: 0,
      kind: 'word',
      label: 'kot',
      symbol: { set: 'own', ref: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(own.status).toBe(422);
    expect(own.body).toEqual({ error: 'unknown_symbol' });
    const extra = { set: 'extra', ref: '15028' };
    const refused = await api('POST', `/api/boards/${board.id}/tiles`, {
      rev: 1,
      row: 0,
      col: 0,
      kind: 'word',
      label: 'kot',
      symbol: extra,
    });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'extra_set_not_enabled' });

    const granted = await setup({ extraSet: true });
    const grantedHome = await home(granted.api);
    const ok = await addTile(granted.api, grantedHome, {
      row: 0,
      col: 0,
      label: 'kot',
      symbol: extra,
    });
    expect(ok.tile.symbol).toEqual(extra);
  });

  it('resizes only when no tile would fall off the grid', async () => {
    const { api } = await setup();
    let board = await home(api, 4, 5);
    board = (await addTile(api, board, { row: 2, col: 3, label: 'pić' })).board;
    const shrink = await api('PATCH', `/api/boards/${board.id}`, { rev: board.rev, rows: 2 });
    expect(shrink.body).toEqual({ error: 'out_of_bounds' });
    const ok = await api<BoardChanges>('PATCH', `/api/boards/${board.id}`, {
      rev: board.rev,
      rows: 3,
      cols: 4,
      name: 'Dom',
    });
    expect(ok.status).toBe(200);
    expect(changed(ok, board.id)).toMatchObject({ rows: 3, cols: 4, name: 'Dom', rev: 3 });
    const tooBig = await api('PATCH', `/api/boards/${board.id}`, { rev: 3, cols: 13 });
    expect(tooBig.status).toBe(400);
  });

  it('keeps a folder label and its board name in sync', async () => {
    const { api, user } = await setup();
    const start = await home(api);
    const folder = await addTile(api, start, { row: 0, col: 0, kind: 'folder', label: 'Zabawki' });
    const renamed = await api<BoardChanges>('PATCH', `/api/tiles/${folder.tile.id}`, {
      rev: folder.board.rev,
      label: 'Zabawa',
    });
    expect(changed(renamed, folder.child!.id)).toMatchObject({ name: 'Zabawa', rev: 2 });
    const back = await api<BoardChanges>('PATCH', `/api/boards/${folder.child!.id}`, {
      rev: 2,
      name: 'Zabawki',
    });
    expect(changed(back, start.id).tiles[0]!.label).toBe('Zabawki');
    expect(await integrity(user.id)).toEqual([]);
  });

  it('moves and swaps tiles within a board and across boards', async () => {
    const { api, user } = await setup();
    let start = await home(api);
    const a = await addTile(api, start, { row: 0, col: 0, label: 'A' });
    const b = await addTile(api, a.board, { row: 0, col: 1, label: 'B' });
    start = b.board;
    const move = (body: Record<string, unknown>) =>
      api<BoardChanges>('POST', '/api/tiles/move', body);

    // Same cell: nothing changes, not even the revision.
    const noop = await move({
      tileId: a.tile.id,
      rev: start.rev,
      toBoardId: start.id,
      row: 0,
      col: 0,
    });
    expect(changed(noop, start.id).rev).toBe(start.rev);

    const swap = await move({
      tileId: a.tile.id,
      rev: start.rev,
      toBoardId: start.id,
      row: 0,
      col: 1,
    });
    start = changed(swap, start.id);
    expect(start.tiles.map((t) => [t.label, t.row, t.col])).toEqual([
      ['B', 0, 0],
      ['A', 0, 1],
    ]);

    const folder = await addTile(api, start, { row: 1, col: 0, kind: 'folder', label: 'Więcej' });
    start = folder.board;
    let sub = folder.child!;
    const noRev = await move({
      tileId: a.tile.id,
      rev: start.rev,
      toBoardId: sub.id,
      row: 0,
      col: 0,
    });
    expect(noRev.status).toBe(400);
    const across = await move({
      tileId: a.tile.id,
      rev: start.rev,
      toBoardId: sub.id,
      toRev: sub.rev,
      row: 3,
      col: 4,
    });
    expect(across.status).toBe(200);
    start = changed(across, start.id);
    sub = changed(across, sub.id);
    expect(start.tiles.map((t) => t.label)).toEqual(['B', 'Więcej']);
    expect(sub.tiles.map((t) => [t.label, t.row, t.col])).toEqual([['A', 3, 4]]);
    expect(await integrity(user.id)).toEqual([]);
  });

  it('re-parents folders and refuses cycles', async () => {
    const { api, user } = await setup();
    const start = await home(api);
    const outer = await addTile(api, start, { row: 0, col: 0, kind: 'folder', label: 'Dom' });
    const inner = await addTile(api, outer.child!, {
      row: 0,
      col: 0,
      kind: 'folder',
      label: 'Kuchnia',
    });
    const before = await tree(api);
    const move = (body: Record<string, unknown>) => api('POST', '/api/tiles/move', body);

    // Into its own board, and into its own sub-board.
    for (const target of [inner.board, inner.child!]) {
      const res = await move({
        tileId: outer.tile.id,
        rev: outer.board.rev,
        toBoardId: target.id,
        toRev: target.rev,
        row: 1,
        col: 1,
      });
      expect(res.status, target.name).toBe(422);
      expect(res.body).toEqual({ error: 'invalid_move' });
    }
    expect(await tree(api)).toEqual(before);

    // Kuchnia up to the home board: its board now hangs below home.
    const up = await api<BoardChanges>('POST', '/api/tiles/move', {
      tileId: inner.tile.id,
      rev: inner.board.rev,
      toBoardId: start.id,
      toRev: outer.board.rev,
      row: 0,
      col: 1,
    });
    expect(up.status).toBe(200);
    expect(changed(up, inner.child!.id)).toMatchObject({ parentId: start.id, rev: 2 });
    expect(await integrity(user.id)).toEqual([]);

    // Swapping two folders across levels re-parents both.
    const t = await tree(api);
    const homeBoard = find(t, start.id);
    const kuchnia = homeBoard.tiles.find((x) => x.label === 'Kuchnia')!;
    const domBoard = find(t, outer.child!.id);
    const deeper = await addTile(api, domBoard, { row: 2, col: 2, kind: 'folder', label: 'Ogród' });
    const swap = await api<BoardChanges>('POST', '/api/tiles/move', {
      tileId: kuchnia.id,
      rev: homeBoard.rev,
      toBoardId: domBoard.id,
      toRev: deeper.board.rev,
      row: 2,
      col: 2,
    });
    expect(swap.status).toBe(200);
    expect(changed(swap, deeper.child!.id).parentId).toBe(start.id);
    expect(changed(swap, kuchnia.targetBoardId!).parentId).toBe(domBoard.id);
    expect(await integrity(user.id)).toEqual([]);
  });

  it('limits folder depth on create and on move', async () => {
    const { api, user } = await setup();
    const start = await home(api, 1, 2);
    let parent = start;
    const chain: { tileId: string; board: Board }[] = [];
    for (let level = 1; level <= BOARD_LIMITS.maxDepth; level++) {
      const added = await addTile(api, parent, {
        row: 0,
        col: 0,
        kind: 'folder',
        label: `L${level}`,
      });
      chain.push({ tileId: added.tile.id, board: added.board });
      parent = added.child!;
    }
    const tooDeep = await api('POST', `/api/boards/${parent.id}/tiles`, {
      rev: parent.rev,
      row: 0,
      col: 0,
      kind: 'folder',
      label: 'L11',
    });
    expect(tooDeep.body).toEqual({ error: 'too_deep' });
    // Words are fine at the deepest level.
    const word = await addTile(api, parent, { row: 0, col: 0, label: 'koniec' });

    // A two-level branch moved onto the depth-9 board would reach depth 11.
    const t = await tree(api);
    const startNow = find(t, start.id);
    const branch = await addTile(api, startNow, { row: 0, col: 1, kind: 'folder', label: 'B1' });
    await addTile(api, branch.child!, { row: 0, col: 0, kind: 'folder', label: 'B2' });
    const level9 = find(await tree(api), chain[9]!.board.id);
    const res = await api('POST', '/api/tiles/move', {
      tileId: branch.tile.id,
      rev: branch.board.rev,
      toBoardId: level9.id,
      toRev: level9.rev,
      row: 0,
      col: 1,
    });
    expect(res.body).toEqual({ error: 'too_deep' });
    expect(word.board.tiles).toHaveLength(1);
    expect(await integrity(user.id)).toEqual([]);
  });

  it('deletes a folder with its whole subtree and keeps the counters right', async () => {
    const { api, user } = await setup();
    const start = await home(api);
    const folder = await addTile(api, start, { row: 0, col: 0, kind: 'folder', label: 'Jedzenie' });
    const sub = await addTile(api, folder.child!, {
      row: 0,
      col: 0,
      kind: 'folder',
      label: 'Owoce',
    });
    await addTile(api, sub.child!, { row: 0, col: 0, label: 'jabłko' });
    await addTile(api, sub.board, { row: 0, col: 1, label: 'zupa' });
    const keep = await addTile(api, folder.board, { row: 0, col: 1, label: 'pić' });

    const del = await api<BoardChanges>(
      'DELETE',
      `/api/tiles/${folder.tile.id}?rev=${keep.board.rev}`,
    );
    expect(del.status).toBe(200);
    expect(del.body.removed.sort()).toEqual([folder.child!.id, sub.child!.id].sort());
    expect(changed(del, start.id).tiles.map((t) => t.label)).toEqual(['pić']);
    const t = await tree(api);
    expect(t.boards).toHaveLength(1);
    expect(await integrity(user.id)).toEqual([]);

    expect((await api('DELETE', `/api/tiles/${folder.tile.id}?rev=99`)).status).toBe(404);
    for (const rev of ['', '0', '-1', '1.5', 'abc', '9'.repeat(20)]) {
      expect((await api('DELETE', `/api/tiles/${keep.tile.id}?rev=${rev}`)).status, rev).toBe(400);
    }
  });

  it('converts words to folders and back', async () => {
    const { api, user } = await setup();
    const start = await home(api);
    const word = await addTile(api, start, { row: 0, col: 0, label: 'Zwierzęta' });
    const toFolder = await api<BoardChanges>('PATCH', `/api/tiles/${word.tile.id}`, {
      rev: word.board.rev,
      kind: 'folder',
      folder: { rows: 3, cols: 3 },
    });
    expect(toFolder.status).toBe(200);
    const folderTile = changed(toFolder, start.id).tiles[0]!;
    const child = changed(toFolder, folderTile.targetBoardId!);
    expect(child).toMatchObject({ name: 'Zwierzęta', rows: 3, cols: 3, parentId: start.id });
    const inner = await addTile(api, child, { row: 0, col: 0, label: 'pies' });

    // A grid only makes sense when a folder is created.
    const gridOnly = await api('PATCH', `/api/tiles/${word.tile.id}`, {
      rev: changed(toFolder, start.id).rev,
      folder: { rows: 2, cols: 2 },
    });
    expect(gridOnly.status).toBe(400);

    const toWord = await api<BoardChanges>('PATCH', `/api/tiles/${word.tile.id}`, {
      rev: changed(toFolder, start.id).rev,
      kind: 'word',
    });
    expect(toWord.body.removed).toEqual([inner.board.id]);
    expect(changed(toWord, start.id).tiles[0]).toMatchObject({ kind: 'word', targetBoardId: null });
    expect((await tree(api)).boards).toHaveLength(1);
    expect(await integrity(user.id)).toEqual([]);
  });

  it('updates and clears tile style and symbol', async () => {
    const { api } = await setup();
    const start = await home(api);
    const tile = await addTile(api, start, {
      row: 0,
      col: 0,
      label: 'chcę',
      symbol: { set: 'arasaac', ref: '5441' },
      colorRole: 'verb',
    });
    const res = await api<BoardChanges>('PATCH', `/api/tiles/${tile.tile.id}`, {
      rev: tile.board.rev,
      symbol: null,
      colorRole: null,
      fontSize: 'L',
    });
    expect(changed(res, start.id).tiles[0]).toMatchObject({
      label: 'chcę',
      symbol: null,
      colorRole: null,
      fontSize: 'L',
      labelPosition: 'bottom',
    });
  });

  it('enforces the per-account quotas', async () => {
    const { api, user } = await setup();
    const start = await home(api);
    await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
      state.storage.sql.exec(
        'UPDATE vault_meta SET boards = ?, tiles = ? WHERE id = 1',
        BOARD_LIMITS.maxBoards,
        BOARD_LIMITS.maxTiles - 1,
      );
    });
    const folder = await api('POST', `/api/boards/${start.id}/tiles`, {
      rev: 1,
      row: 0,
      col: 0,
      kind: 'folder',
      label: 'Więcej',
    });
    expect(folder.body).toEqual({ error: 'quota_exceeded' });
    const last = await addTile(api, start, { row: 0, col: 0, label: 'ostatni' });
    const over = await api('POST', `/api/boards/${start.id}/tiles`, {
      rev: last.board.rev,
      row: 0,
      col: 1,
      kind: 'word',
      label: 'za dużo',
    });
    expect(over.body).toEqual({ error: 'quota_exceeded' });
  });

  it('caps request bodies', async () => {
    const { api } = await setup();
    const res = await api('POST', '/api/boards/home', {
      name: 'Start',
      rows: 4,
      cols: 5,
      pad: 'x'.repeat(20_000),
    });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'payload_too_large' });
  });

  it('isolates vaults: IDs from another account behave like missing ones', async () => {
    const owner = await setup();
    const start = await home(owner.api);
    const tile = await addTile(owner.api, start, { row: 0, col: 0, kind: 'folder', label: 'Moje' });
    const before = await tree(owner.api);

    const intruder = await setup();
    const other = await home(intruder.api);
    const mine = await addTile(intruder.api, other, { row: 0, col: 0, label: 'moje' });
    const attempts: [string, string, unknown?][] = [
      ['PATCH', `/api/boards/${start.id}`, { rev: tile.board.rev, name: 'X' }],
      [
        'POST',
        `/api/boards/${start.id}/tiles`,
        { rev: tile.board.rev, row: 1, col: 1, kind: 'word', label: 'X' },
      ],
      ['PATCH', `/api/tiles/${tile.tile.id}`, { rev: tile.board.rev, label: 'X' }],
      ['DELETE', `/api/tiles/${tile.tile.id}?rev=${tile.board.rev}`],
      [
        'POST',
        '/api/tiles/move',
        { tileId: tile.tile.id, rev: tile.board.rev, toBoardId: start.id, row: 1, col: 1 },
      ],
      // Own tile into a foreign board.
      [
        'POST',
        '/api/tiles/move',
        {
          tileId: mine.tile.id,
          rev: mine.board.rev,
          toBoardId: start.id,
          toRev: tile.board.rev,
          row: 1,
          col: 1,
        },
      ],
    ];
    for (const [method, path, body] of attempts) {
      const res = await intruder.api(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
    expect(await tree(owner.api)).toEqual(before);
    expect((await tree(intruder.api)).boards).toEqual([mine.board]);
  });
});
