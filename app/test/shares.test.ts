import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  SHARE_LIMITS,
  type Board,
  type BoardChanges,
  type BoardTree,
  type ReceivedShareView,
  type SentShare,
  type ShareLists,
} from '@relaacja/shared';
import { describe, expect, it, vi } from 'vitest';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { apiAs, insertUser, makeApp, sessionCookie, uploadAs, writeHeaders } from './helpers.ts';
import { webp } from './images.ts';

const { call } = makeApp();

async function account(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}
type Account = Awaited<ReturnType<typeof account>>;

async function home(user: Account, rows = 3, cols = 3): Promise<Board> {
  const res = await user.api<BoardChanges>('POST', '/api/boards/home', {
    name: 'Start',
    rows,
    cols,
  });
  return res.body.boards[0]!;
}

/** Home → folder "Jedzenie" (with a photo tile "Zupa" and a sub-folder "Owoce" → "jabłko"). */
async function sender() {
  const user = await account();
  const start = await home(user);
  const photo = await uploadAs(call, user.cookie)<{ media: { id: string } }>('Zupa', webp(20, 20));
  const folder = await user.api<BoardChanges>('POST', `/api/boards/${start.id}/tiles`, {
    rev: start.rev,
    row: 0,
    col: 0,
    kind: 'folder',
    label: 'Jedzenie',
    colorRole: 'noun',
    symbol: { set: 'arasaac', ref: '2349' },
  });
  const food = folder.body.boards.find((b) => b.name === 'Jedzenie')!;
  await user.api('POST', `/api/boards/${food.id}/tiles`, {
    rev: food.rev,
    row: 0,
    col: 1,
    kind: 'word',
    label: 'Zupa',
    symbol: { set: 'own', ref: photo.body.media.id },
  });
  const sub = await user.api<BoardChanges>('POST', `/api/boards/${food.id}/tiles`, {
    rev: food.rev + 1,
    row: 1,
    col: 0,
    kind: 'folder',
    label: 'Owoce',
  });
  const fruit = sub.body.boards.find((b) => b.name === 'Owoce')!;
  await user.api('POST', `/api/boards/${fruit.id}/tiles`, {
    rev: fruit.rev,
    row: 0,
    col: 0,
    kind: 'word',
    label: 'jabłko',
    symbol: { set: 'arasaac', ref: '2462' },
  });
  return { user, start, food, photoId: photo.body.media.id };
}

const send = (from: Account, boardId: string, email: string) =>
  from.api<{ share: SentShare }>('POST', '/api/shares', { boardId, email });

describe('sharing a board (PLAN §2.8)', () => {
  it('answers the same whether the address has an account or not', async () => {
    const { user, food } = await sender();
    const recipient = await account();
    const known = await send(user, food.id, recipient.email.toUpperCase());
    const unknown = await send(user, food.id, 'nobody-here@example.com');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    const shape = (s: SentShare) => ({ ...s, id: 'x', recipient: 'x', createdAt: 0, expiresAt: 0 });
    expect(shape(known.body.share)).toEqual(shape(unknown.body.share));
    expect(known.body.share).toMatchObject({
      name: 'Jedzenie',
      status: 'pending',
      boards: 2,
      tiles: 3,
      photos: 1,
      recipient: recipient.email,
    });

    const inbox = await recipient.api<ShareLists>('GET', '/api/shares');
    expect(inbox.body.received).toHaveLength(1);
    expect(inbox.body.received[0]).toMatchObject({
      name: 'Jedzenie',
      sender: { email: user.email, name: 'Test' },
      boards: 2,
      tiles: 3,
      photos: 1,
    });
    const outbox = await user.api<ShareLists>('GET', '/api/shares');
    expect(outbox.body.sent.map((s) => s.status)).toEqual(['pending', 'pending']);
  });

  it('is looked at, then accepted as a new folder with its sub-boards and photos', async () => {
    const { user, food, photoId } = await sender();
    const recipient = await account();
    const own = await home(recipient, 2, 2);
    await send(user, food.id, recipient.email);
    const [entry] = (await recipient.api<ShareLists>('GET', '/api/shares')).body.received;

    const view = await recipient.api<ReceivedShareView>('GET', `/api/shares/received/${entry!.id}`);
    expect(view.body.package.name).toBe('Jedzenie');
    expect(view.body.package.tile).toMatchObject({ colorRole: 'noun', symbol: { set: 'arasaac' } });
    expect(view.body.photos).toEqual([expect.objectContaining({ key: photoId, label: 'Zupa' })]);
    const photo = await call(`/api/shares/received/${entry!.id}/photos/${photoId}`, {
      headers: { Cookie: recipient.cookie },
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/webp');
    // Nobody else can open it, not even the sender.
    expect((await user.api('GET', `/api/shares/received/${entry!.id}`)).status).toBe(404);

    const accepted = await recipient.api<BoardChanges>(
      'POST',
      `/api/shares/received/${entry!.id}/accept`,
      { boardId: own.id, rev: own.rev },
    );
    expect(accepted.status).toBe(200);
    const tree = (await recipient.api<BoardTree>('GET', '/api/boards')).body;
    const start = tree.boards.find((b) => b.id === own.id)!;
    expect(start.tiles).toEqual([
      expect.objectContaining({
        row: 0,
        col: 0,
        kind: 'folder',
        label: 'Jedzenie',
        colorRole: 'noun',
      }),
    ]);
    const copy = tree.boards.find((b) => b.id === start.tiles[0]!.targetBoardId)!;
    expect(copy.tiles.map((t) => t.label)).toEqual(['Zupa', 'Owoce']);
    const zupa = copy.tiles[0]!;
    expect(zupa.symbol?.set).toBe('own');
    expect(zupa.symbol?.ref).not.toBe(photoId);
    const bytes = await call(`/api/media/${zupa.symbol!.ref}`, {
      headers: { Cookie: recipient.cookie },
    });
    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(webp(20, 20));
    const fruit = tree.boards.find((b) => b.id === copy.tiles[1]!.targetBoardId)!;
    expect(fruit.name).toBe('Owoce');
    expect(fruit.tiles.map((t) => t.label)).toEqual(['jabłko']);

    // The inbox is empty and the sender learns the decision.
    expect((await recipient.api<ShareLists>('GET', '/api/shares')).body.received).toEqual([]);
    const sent = (await user.api<ShareLists>('GET', '/api/shares')).body.sent;
    expect(sent[0]).toMatchObject({ status: 'accepted', decidedAt: expect.any(Number) });
    expect(
      (
        await recipient.api('POST', `/api/shares/received/${entry!.id}/accept`, {
          boardId: own.id,
          rev: own.rev + 1,
        })
      ).status,
    ).toBe(404);
  });

  it('is rejected without leaving anything behind', async () => {
    const { user, food } = await sender();
    const recipient = await account();
    await send(user, food.id, recipient.email);
    const [entry] = (await recipient.api<ShareLists>('GET', '/api/shares')).body.received;
    expect((await recipient.api('POST', `/api/shares/received/${entry!.id}/reject`)).status).toBe(
      204,
    );
    expect((await recipient.api<ShareLists>('GET', '/api/shares')).body.received).toEqual([]);
    expect((await user.api<ShareLists>('GET', '/api/shares')).body.sent[0]!.status).toBe(
      'rejected',
    );
    const left = await runInDurableObject(
      vaultFor(env, recipient.id),
      (_i: UserVault, state) =>
        state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM inbox_media').one().n,
    );
    expect(left).toBe(0);
    // Off the sender's own list.
    const sentId = (await user.api<ShareLists>('GET', '/api/shares')).body.sent[0]!.id;
    expect((await user.api('DELETE', `/api/shares/sent/${sentId}`)).status).toBe(204);
    expect((await user.api<ShareLists>('GET', '/api/shares')).body.sent).toEqual([]);
  });

  it('a home board travels without a folder look', async () => {
    const { user, start } = await sender();
    const recipient = await account();
    const own = await home(recipient, 1, 2);
    await send(user, start.id, recipient.email);
    const [entry] = (await recipient.api<ShareLists>('GET', '/api/shares')).body.received;
    expect(entry).toMatchObject({ name: 'Start', boards: 3, tiles: 4 });
    const view = await recipient.api<ReceivedShareView>('GET', `/api/shares/received/${entry!.id}`);
    expect(view.body.package.tile).toBeUndefined();
    const ok = await recipient.api('POST', `/api/shares/received/${entry!.id}/accept`, {
      boardId: own.id,
      rev: own.rev,
    });
    expect(ok.status).toBe(200);
  });
});

describe('sharing: refusals and limits', () => {
  it('accepting needs a free cell, the current revision and room in the quotas', async () => {
    const { user, food } = await sender();
    const recipient = await account();
    const tiny = await home(recipient, 1, 1);
    await send(user, food.id, recipient.email);
    const [entry] = (await recipient.api<ShareLists>('GET', '/api/shares')).body.received;
    const accept = (boardId: string, rev: number) =>
      recipient.api('POST', `/api/shares/received/${entry!.id}/accept`, { boardId, rev });

    expect((await accept(tiny.id, tiny.rev + 5)).status).toBe(409);
    await recipient.api('POST', `/api/boards/${tiny.id}/tiles`, {
      rev: tiny.rev,
      row: 0,
      col: 0,
      kind: 'word',
      label: 'pełno',
    });
    expect(await accept(tiny.id, tiny.rev + 1)).toMatchObject({
      status: 422,
      body: { error: 'board_full' },
    });
    // Photo quota: the recipient is (pretend) full.
    await runInDurableObject(vaultFor(env, recipient.id), (_i: UserVault, state) => {
      state.storage.sql.exec('UPDATE vault_meta SET media = 2000 WHERE id = 1');
    });
    await recipient.api('PATCH', `/api/boards/${tiny.id}`, { rev: tiny.rev + 1, rows: 2 });
    expect(await accept(tiny.id, tiny.rev + 2)).toMatchObject({
      status: 422,
      body: { error: 'quota_exceeded' },
    });
    // Nothing was half-done: the share still waits.
    expect((await recipient.api<ShareLists>('GET', '/api/shares')).body.received).toHaveLength(1);
    const boards = (await recipient.api<BoardTree>('GET', '/api/boards')).body.boards;
    expect(boards).toHaveLength(1);
  });

  it('refuses too large packages and more than the daily sends', async () => {
    const { user, food, photoId } = await sender();
    await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
      state.storage.sql.exec(
        'UPDATE media SET bytes = ? WHERE id = ?',
        SHARE_LIMITS.maxPhotoBytes + 1,
        photoId,
      );
    });
    expect(await send(user, food.id, 'a@example.com')).toMatchObject({
      status: 422,
      body: { error: 'too_large' },
    });

    const other = await sender();
    for (let i = 0; i < SHARE_LIMITS.maxSendsPerDay; i++) {
      expect((await send(other.user, other.food.id, `r${i}@example.com`)).status).toBe(202);
    }
    expect(await send(other.user, other.food.id, 'one-more@example.com')).toMatchObject({
      status: 429,
      body: { error: 'daily_limit' },
    });
    expect((await send(other.user, 'a'.repeat(26), 'x@example.com')).status).toBe(404);
    expect((await other.user.api('POST', '/api/shares', { boardId: other.food.id })).status).toBe(
      400,
    );
  });

  it('a full inbox drops further shares silently; blocked accounts receive nothing', async () => {
    const recipient = await account();
    await runInDurableObject(vaultFor(env, recipient.id), (_i: UserVault, state) => {
      for (let i = 0; i < SHARE_LIMITS.maxPending; i++) {
        state.storage.sql.exec(
          `INSERT INTO inbox (id, sender_id, share_id, name, package, boards, tiles, photos, bytes,
                              created_at, expires_at)
           VALUES (?, 's', 's', 'x', '{}', 1, 0, 0, 0, 0, ?)`,
          `filler${i}`,
          Date.now() + 1e9,
        );
      }
    });
    const { user, food } = await sender();
    expect((await send(user, food.id, recipient.email)).status).toBe(202);
    expect((await recipient.api<ShareLists>('GET', '/api/shares')).body.received).toHaveLength(
      SHARE_LIMITS.maxPending,
    );

    const blocked = await account({ status: 'blocked' });
    expect((await send(user, food.id, blocked.email)).status).toBe(202);
    const inbox = await runInDurableObject(
      vaultFor(env, blocked.id),
      (_i: UserVault, state) =>
        state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM inbox').one().n,
    );
    expect(inbox).toBe(0);
  });

  it('undecided shares expire for both sides', async () => {
    const { user, food } = await sender();
    const recipient = await account();
    await send(user, food.id, recipient.email);
    for (const id of [recipient.id, user.id]) {
      await runInDurableObject(vaultFor(env, id), (_i: UserVault, state) => {
        state.storage.sql.exec('UPDATE inbox SET expires_at = 1');
        state.storage.sql.exec('UPDATE outbox SET expires_at = 1');
      });
    }
    expect((await recipient.api<ShareLists>('GET', '/api/shares')).body.received).toEqual([]);
    expect((await user.api<ShareLists>('GET', '/api/shares')).body.sent[0]!.status).toBe('expired');
  });

  it('a deleted sender shows as gone and is not woken up by the decision', async () => {
    const errors = vi.spyOn(console, 'error');
    const { user, food } = await sender();
    const recipient = await account();
    const own = await home(recipient);
    await send(user, food.id, recipient.email);
    const admin = await account({ role: 'admin' });
    expect(
      (await admin.api('DELETE', `/api/admin/users/${user.id}`, { email: user.email })).status,
    ).toBe(204);
    const [entry] = (await recipient.api<ShareLists>('GET', '/api/shares')).body.received;
    expect(entry!.sender).toBeNull();
    expect(
      (
        await recipient.api('POST', `/api/shares/received/${entry!.id}/accept`, {
          boardId: own.id,
          rev: own.rev,
        })
      ).status,
    ).toBe(200);
    const tables = await runInDurableObject(
      vaultFor(env, user.id),
      (_i: UserVault, state) =>
        state.storage.sql
          .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
          .toArray()
          .filter((r) => !r.name.startsWith('_cf_')).length,
    );
    expect(tables).toBe(0);
    // A call into the wiped vault would have failed in the background and been logged.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('a board read from a file (POST /api/boards/:id/import)', () => {
  const pkg = (symbolRef: string) => ({
    v: 1,
    name: 'Z pliku',
    tile: {
      labelPosition: 'bottom',
      fontSize: 'M',
      colorRole: 'verb',
      colorMode: 'background',
      symbol: null,
    },
    board: {
      rows: 1,
      cols: 2,
      tiles: [
        { row: 0, col: 0, label: 'moje', symbol: { set: 'own', ref: symbolRef } },
        { row: 0, col: 1, label: 'obce', symbol: { set: 'own', ref: 'z'.repeat(26) } },
      ],
    },
  });

  it('becomes a new folder; photos it names must be the account’s own', async () => {
    const user = await account();
    const start = await home(user, 1, 2);
    const photo = await uploadAs(call, user.cookie)<{ media: { id: string } }>('Moje', webp(8, 8));
    const res = await user.api<BoardChanges>('POST', `/api/boards/${start.id}/import`, {
      rev: start.rev,
      package: pkg(photo.body.media.id),
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('totals');
    const tree = (await user.api<BoardTree>('GET', '/api/boards')).body;
    const folder = tree.boards.find((b) => b.id === start.id)!.tiles[0]!;
    expect(folder).toMatchObject({ kind: 'folder', label: 'Z pliku', colorRole: 'verb' });
    const copy = tree.boards.find((b) => b.id === folder.targetBoardId)!;
    expect(copy.tiles.map((t) => [t.label, t.symbol])).toEqual([
      ['moje', { set: 'own', ref: photo.body.media.id }],
      ['obce', null],
    ]);
    // Another account's photo ID is as unknown as a made-up one.
    const other = await account();
    const otherHome = await home(other);
    const stolen = await other.api<BoardChanges>('POST', `/api/boards/${otherHome.id}/import`, {
      rev: otherHome.rev,
      package: pkg(photo.body.media.id),
    });
    const otherTree = (await other.api<BoardTree>('GET', '/api/boards')).body;
    const otherCopy = otherTree.boards.find((b) => b.parentId === otherHome.id)!;
    expect(stolen.status).toBe(200);
    expect(otherCopy.tiles.every((t) => t.symbol === null)).toBe(true);
  });

  it('refuses malformed, oversized and stale imports', async () => {
    const user = await account();
    const start = await home(user, 1, 2);
    const path = `/api/boards/${start.id}/import`;
    expect((await user.api('POST', path, { rev: start.rev })).status).toBe(400);
    expect(
      (await user.api('POST', path, { rev: start.rev, package: { ...pkg('x'), v: 2 } })).status,
    ).toBe(400);
    const wide = {
      ...pkg('a'.repeat(26)),
      board: {
        rows: 12,
        cols: 12,
        tiles: Array.from({ length: 144 }, (_, i) => ({
          row: Math.floor(i / 12),
          col: i % 12,
          kind: 'folder',
          label: `f${i}`,
          board: {
            rows: 12,
            cols: 12,
            tiles: Array.from({ length: 13 }, (_, j) => ({
              row: 0,
              col: j % 12,
              label: `w${j}`,
            })),
          },
        })),
      },
    };
    // More than 100 boards (and a duplicate cell): refused before anything is written.
    expect((await user.api('POST', path, { rev: start.rev, package: wide })).status).toBe(400);
    expect(
      (await user.api('POST', path, { rev: start.rev + 3, package: pkg('x'.repeat(26)) })).status,
    ).toBe(409);
    const res = await call(path, {
      method: 'POST',
      headers: { ...writeHeaders(user.cookie) },
      body: 'x'.repeat(3 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    const raw = await call(path, {
      method: 'POST',
      headers: { ...writeHeaders(user.cookie) },
      body: '{not json',
    });
    expect(raw.status).toBe(400);
  });
});
