import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Board, BoardChanges, BoardTree, CatalogEntry, CatalogView } from '@relaacja/shared';
import { describe, expect, it } from 'vitest';
import { catalogFor, type Catalog } from '../src/worker/catalog/catalog.ts';
import { apiAs, insertUser, makeApp, sessionCookie, uploadAs } from './helpers.ts';
import { webp } from './images.ts';

const { call } = makeApp();

async function account(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}
type Account = Awaited<ReturnType<typeof account>>;

async function home(user: Account, rows = 2, cols = 2): Promise<Board> {
  const res = await user.api<BoardChanges>('POST', '/api/boards/home', {
    name: 'Start',
    rows,
    cols,
  });
  return res.body.boards[0]!;
}

/** An admin's folder "Poranek" with a photo tile and an ARASAAC tile. */
async function adminBoard() {
  const admin = await account({ role: 'admin' });
  const start = await home(admin);
  const photo = await uploadAs(call, admin.cookie)<{ media: { id: string } }>('Mama', webp(12, 12));
  const folder = await admin.api<BoardChanges>('POST', `/api/boards/${start.id}/tiles`, {
    rev: start.rev,
    row: 0,
    col: 0,
    kind: 'folder',
    label: 'Poranek',
  });
  const morning = folder.body.boards.find((b) => b.name === 'Poranek')!;
  await admin.api('POST', `/api/boards/${morning.id}/tiles`, {
    rev: morning.rev,
    row: 0,
    col: 0,
    kind: 'word',
    label: 'mama',
    symbol: { set: 'own', ref: photo.body.media.id },
  });
  await admin.api('POST', `/api/boards/${morning.id}/tiles`, {
    rev: morning.rev + 1,
    row: 0,
    col: 1,
    kind: 'word',
    label: 'myć zęby',
    symbol: { set: 'arasaac', ref: '2694' },
  });
  return { admin, morning };
}

async function clearCatalog() {
  await runInDurableObject(catalogFor(env), (_i: Catalog, state) => {
    state.storage.sql.exec('DELETE FROM entries');
  });
}

async function audit(actor: string) {
  const { results } = await env.DB.prepare(
    'SELECT action, details FROM admin_audit WHERE actor_user_id = ?1 ORDER BY rowid',
  )
    .bind(actor)
    .all<{ action: string; details: string }>();
  return results.map((r) => [r.action, JSON.parse(r.details)]);
}

describe('catalogue of public boards (PLAN §2.8)', () => {
  it('an admin publishes; own photos only with explicit consent', async () => {
    await clearCatalog();
    const { admin, morning } = await adminBoard();
    const without = await admin.api<CatalogEntry>('POST', '/api/admin/catalog', {
      boardId: morning.id,
      name: 'Poranek',
      description: 'Rutyna poranna\nkrok po kroku',
      includePhotos: false,
    });
    expect(without.status).toBe(201);
    expect(without.body).toMatchObject({ name: 'Poranek', photos: 0, boards: 1, tiles: 2 });
    const withPhotos = await admin.api<CatalogEntry>('POST', '/api/admin/catalog', {
      boardId: morning.id,
      name: 'Poranek ze zdjęciem',
      description: '',
      includePhotos: true,
    });
    expect(withPhotos.body).toMatchObject({ photos: 1 });

    const reader = await account();
    const list = await reader.api<{ entries: CatalogEntry[] }>('GET', '/api/catalog');
    expect(list.body.entries.map((e) => e.name)).toEqual(['Poranek', 'Poranek ze zdjęciem']);
    const plain = await reader.api<CatalogView>('GET', `/api/catalog/${without.body.id}`);
    expect(plain.body.package.board.tiles.map((t) => [t.label, t.symbol])).toEqual([
      ['mama', null],
      ['myć zęby', { set: 'arasaac', ref: '2694' }],
    ]);
    expect(plain.body.entry.description).toBe('Rutyna poranna\nkrok po kroku');
    const full = await reader.api<CatalogView>('GET', `/api/catalog/${withPhotos.body.id}`);
    const key = full.body.photos[0]!.key;
    const photo = await call(`/api/catalog/${withPhotos.body.id}/photos/${key}`, {
      headers: { Cookie: reader.cookie },
    });
    expect(photo.status).toBe(200);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(webp(12, 12));
    expect(await audit(admin.id)).toEqual([
      ['catalog.publish', { entry: without.body.id, name: 'Poranek', photos: 0 }],
      ['catalog.publish', { entry: withPhotos.body.id, name: 'Poranek ze zdjęciem', photos: 1 }],
    ]);
  });

  it('anyone copies an entry onto a board of theirs, photos included', async () => {
    await clearCatalog();
    const { admin, morning } = await adminBoard();
    const entry = await admin.api<CatalogEntry>('POST', '/api/admin/catalog', {
      boardId: morning.id,
      name: 'Poranek',
      description: '',
      includePhotos: true,
    });
    const reader = await account();
    const start = await home(reader);
    const copied = await reader.api('POST', `/api/catalog/${entry.body.id}/import`, {
      boardId: start.id,
      rev: start.rev,
    });
    expect(copied.status).toBe(200);
    const tree = (await reader.api<BoardTree>('GET', '/api/boards')).body;
    const folder = tree.boards.find((b) => b.id === start.id)!.tiles[0]!;
    expect(folder).toMatchObject({ kind: 'folder', label: 'Poranek' });
    const copy = tree.boards.find((b) => b.id === folder.targetBoardId)!;
    const mama = copy.tiles.find((t) => t.label === 'mama')!;
    const bytes = await call(`/api/media/${mama.symbol!.ref}`, {
      headers: { Cookie: reader.cookie },
    });
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(webp(12, 12));
    // The entry stays for the next person.
    expect((await reader.api('GET', `/api/catalog/${entry.body.id}`)).status).toBe(200);
    expect(
      (
        await reader.api('POST', `/api/catalog/${entry.body.id}/import`, {
          boardId: start.id,
          rev: start.rev,
        })
      ).status,
    ).toBe(409);
  });

  it('admins rename, describe and withdraw entries; others cannot', async () => {
    await clearCatalog();
    const { admin, morning } = await adminBoard();
    const entry = await admin.api<CatalogEntry>('POST', '/api/admin/catalog', {
      boardId: morning.id,
      name: 'Poranek',
      description: '',
      includePhotos: false,
    });
    const path = `/api/admin/catalog/${entry.body.id}`;
    const user = await account();
    expect((await user.api('PATCH', path, { name: 'X' })).status).toBe(403);
    expect((await user.api('DELETE', path)).status).toBe(403);
    expect((await user.api('POST', '/api/admin/catalog', {})).status).toBe(403);

    const other = await account({ role: 'admin' });
    const renamed = await other.api<CatalogEntry>('PATCH', path, {
      name: 'Poranek w domu',
      description: 'Dla przedszkolaków',
    });
    expect(renamed.body).toMatchObject({
      name: 'Poranek w domu',
      description: 'Dla przedszkolaków',
    });
    expect((await other.api('PATCH', path, {})).status).toBe(400);
    expect((await other.api('PATCH', path, { description: 'a\u0007b' })).status).toBe(400);
    expect((await other.api('DELETE', path)).status).toBe(204);
    expect((await other.api('DELETE', path)).status).toBe(404);
    expect((await user.api('GET', `/api/catalog/${entry.body.id}`)).status).toBe(404);
    expect(await audit(other.id)).toEqual([
      ['catalog.edit', { entry: entry.body.id, name: 'Poranek w domu' }],
      ['catalog.withdraw', { entry: entry.body.id, name: 'Poranek w domu' }],
    ]);
  });

  it('publishing needs one of the admin’s own boards and validates its input', async () => {
    const { admin } = await adminBoard();
    const user = await account();
    const theirs = await home(user);
    expect(
      (
        await admin.api('POST', '/api/admin/catalog', {
          boardId: theirs.id,
          name: 'Cudza',
          description: '',
          includePhotos: false,
        })
      ).status,
    ).toBe(404);
    for (const body of [
      { boardId: theirs.id, name: '', description: '', includePhotos: false },
      { boardId: theirs.id, name: 'x', description: 'x'.repeat(501), includePhotos: false },
      { boardId: theirs.id, name: 'x', description: '' },
    ]) {
      expect((await admin.api('POST', '/api/admin/catalog', body)).status).toBe(400);
    }
  });
});

describe('catalogue names', () => {
  it('the folder a copy becomes is named as in the catalogue, also after a rename', async () => {
    await clearCatalog();
    const { admin, morning } = await adminBoard();
    const entry = await admin.api<CatalogEntry>('POST', '/api/admin/catalog', {
      boardId: morning.id,
      name: 'Rano w domu',
      description: '',
      includePhotos: false,
    });
    await admin.api('PATCH', `/api/admin/catalog/${entry.body.id}`, { name: 'Poranek dziecka' });
    const reader = await account();
    const start = await home(reader);
    const view = await reader.api<CatalogView>('GET', `/api/catalog/${entry.body.id}`);
    expect(view.body.package.name).toBe('Poranek dziecka');
    await reader.api('POST', `/api/catalog/${entry.body.id}/import`, {
      boardId: start.id,
      rev: start.rev,
    });
    const tree = (await reader.api<BoardTree>('GET', '/api/boards')).body;
    expect(tree.boards.find((b) => b.id === start.id)!.tiles[0]!.label).toBe('Poranek dziecka');
  });
});
