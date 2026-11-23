import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { catalogFor } from '../src/worker/catalog/catalog.ts';
import { ROUTES } from '../src/worker/routes/registry.ts';
import type { BoardChanges, ShareLists } from '@relaacja/shared';
import {
  apiAs,
  insertUser,
  makeApp,
  formHeaders,
  photoForm,
  sessionCookie,
  uploadAs,
  writeHeaders,
  type TestUser,
} from './helpers.ts';
import { webp } from './images.ts';

/**
 * Authorization matrix (PLAN §7): every registered route × every principal, with an
 * explicit expected status. Adding a route without a row here fails the suite.
 */
type Principal = 'anon' | 'userA' | 'userB' | 'extra' | 'blocked' | 'admin' | 'superadmin';
const PRINCIPALS: Principal[] = [
  'anon',
  'userA',
  'userB',
  'extra',
  'blocked',
  'admin',
  'superadmin',
];

const all = (status: number) =>
  Object.fromEntries(PRINCIPALS.map((p) => [p, status])) as Record<Principal, number>;
const userOnly = { ...all(200), anon: 401, blocked: 403 };
const adminsOnly = { ...all(403), anon: 401, admin: 200, superadmin: 200 };
const superadminOnly = { ...all(403), anon: 401, superadmin: 200 };
/** A valid age recipient (X25519) from the age-encryption documentation. */
const RECIPIENT = 'age1tgyuvdlmpejqsdf847hevurz9szk7vf3j7ytfyqecgzvphvu2d8qrtaxl6';
/** Objects in user A's vault: everybody else gets the same 404 as for a missing ID. */
const ownedByA = { ...all(404), anon: 401, blocked: 403, userA: 200 };

/** IDs of a home board with one word tile and of a photo, created in user A's vault. */
interface Fixture {
  boardId: string;
  tileId: string;
  mediaId: string;
  /** User A, the account admin routes act on. */
  ownerId: string;
  ownerEmail: string;
  /** A share of user A's home board, sent by user A to itself. */
  receivedId: string;
  sentId: string;
  /** A catalogue entry (published directly into the catalogue object). */
  catalogId: string;
  favoriteId: string;
}

const CATALOG_PHOTO = 'c'.repeat(26);

type Row = {
  body?: Record<string, unknown> | ((f: Fixture) => Record<string, unknown>);
  /** Multipart upload instead of a JSON body. */
  form?: () => FormData;
  path?: string | ((f: Fixture) => string);
  status: Record<Principal, number>;
};

const EXPECTED: Record<string, Row> = {
  'GET /api/health': { status: all(200) },
  'GET /api/auth/login': { status: all(302) },
  'GET /api/auth/callback': { status: all(302) },
  'POST /api/auth/logout': { status: all(204) },
  'POST /api/auth/logout-all': { status: { ...all(204), anon: 401, blocked: 403 } },
  // DEV_AUTH is off in tests: indistinguishable from a missing route.
  'POST /api/auth/dev-login': { body: { sub: 'x', email: 'x@example.com' }, status: all(404) },
  'GET /api/me': { status: userOnly },
  'GET /api/settings': { status: userOnly },
  'PATCH /api/settings': { body: { returnToHome: false }, status: userOnly },
  'GET /api/boards': { status: userOnly },
  // Fresh accounts create their own home board; user A already has one (the fixture).
  'POST /api/boards/home': {
    body: { name: 'Start', rows: 4, cols: 5 },
    status: { ...all(201), anon: 401, blocked: 403, userA: 409 },
  },
  'PATCH /api/boards/:id': {
    path: (f) => `/api/boards/${f.boardId}`,
    body: { rev: 2, name: 'Nowa' },
    status: ownedByA,
  },
  'POST /api/boards/:id/tiles': {
    path: (f) => `/api/boards/${f.boardId}/tiles`,
    body: { rev: 2, row: 1, col: 1, kind: 'word', label: 'pić' },
    status: { ...ownedByA, userA: 201 },
  },
  'PATCH /api/tiles/:id': {
    path: (f) => `/api/tiles/${f.tileId}`,
    body: { rev: 2, label: 'jeść' },
    status: ownedByA,
  },
  'DELETE /api/tiles/:id': { path: (f) => `/api/tiles/${f.tileId}?rev=2`, status: ownedByA },
  'POST /api/boards/:id/import': {
    path: (f) => `/api/boards/${f.boardId}/import`,
    body: {
      rev: 2,
      package: { v: 1, name: 'Plik', board: { rows: 1, cols: 1, tiles: [] } },
    },
    status: ownedByA,
  },
  'POST /api/tiles/move': {
    body: (f) => ({ tileId: f.tileId, rev: 2, toBoardId: f.boardId, row: 3, col: 4 }),
    status: ownedByA,
  },
  'GET /api/symbols/preferred': { status: userOnly },
  'PUT /api/symbols/preferred': {
    body: { word: 'chleb', symbol: { set: 'arasaac', ref: '2494' } },
    status: userOnly,
  },
  'GET /api/symbols/category-icons': { status: userOnly },
  'GET /api/favorites': { status: userOnly },
  'POST /api/favorites': {
    body: { items: [{ label: 'tak', symbol: null }] },
    status: { ...all(201), anon: 401, blocked: 403 },
  },
  'DELETE /api/favorites/:id': {
    path: (f) => `/api/favorites/${f.favoriteId}`,
    status: { ...ownedByA, userA: 204 },
  },
  'GET /api/history': { status: userOnly },
  'POST /api/history': {
    body: { entries: [{ at: 1, items: [{ label: 'tak', symbol: null }] }] },
    status: userOnly,
  },
  'DELETE /api/history': { status: { ...all(204), anon: 401, blocked: 403 } },
  'GET /api/media': { status: userOnly },
  'POST /api/media': {
    form: () => photoForm('Mama', webp(64, 64)),
    status: { ...all(201), anon: 401, blocked: 403 },
  },
  'GET /api/media/:id': { path: (f) => `/api/media/${f.mediaId}`, status: ownedByA },
  'PATCH /api/media/:id': {
    path: (f) => `/api/media/${f.mediaId}`,
    body: { label: 'Tata' },
    status: ownedByA,
  },
  'DELETE /api/media/:id': { path: (f) => `/api/media/${f.mediaId}`, status: ownedByA },
  // Sharing: a board of one's own to any address (same answer whether it has an account).
  'POST /api/shares': {
    body: (f) => ({ boardId: f.boardId, email: 'someone@example.com' }),
    status: { ...ownedByA, userA: 202 },
  },
  'GET /api/shares': { status: userOnly },
  'GET /api/shares/received/:id': {
    path: (f) => `/api/shares/received/${f.receivedId}`,
    status: ownedByA,
  },
  'GET /api/shares/received/:id/photos/:key': {
    path: (f) => `/api/shares/received/${f.receivedId}/photos/${f.mediaId}`,
    status: ownedByA,
  },
  'POST /api/shares/received/:id/accept': {
    path: (f) => `/api/shares/received/${f.receivedId}/accept`,
    body: (f) => ({ boardId: f.boardId, rev: 2 }),
    status: ownedByA,
  },
  'POST /api/shares/received/:id/reject': {
    path: (f) => `/api/shares/received/${f.receivedId}/reject`,
    status: { ...ownedByA, userA: 204 },
  },
  'DELETE /api/shares/sent/:id': {
    path: (f) => `/api/shares/sent/${f.sentId}`,
    status: { ...ownedByA, userA: 204 },
  },
  // Catalogue: read and copied by everyone signed in, changed by admins.
  'GET /api/catalog': { status: userOnly },
  'GET /api/catalog/:id': { path: (f) => `/api/catalog/${f.catalogId}`, status: userOnly },
  'GET /api/catalog/:id/photos/:key': {
    path: (f) => `/api/catalog/${f.catalogId}/photos/${CATALOG_PHOTO}`,
    status: userOnly,
  },
  // Copied onto user A's board: everybody else names a board they do not have.
  'POST /api/catalog/:id/import': {
    path: (f) => `/api/catalog/${f.catalogId}/import`,
    body: (f) => ({ boardId: f.boardId, rev: 2 }),
    status: ownedByA,
  },
  // Admins publish their own boards only: user A's board is unknown to them.
  'POST /api/admin/catalog': {
    body: (f) => ({ boardId: f.boardId, name: 'K', description: '', includePhotos: false }),
    status: { ...adminsOnly, admin: 404, superadmin: 404 },
  },
  'PATCH /api/admin/catalog/:id': {
    path: (f) => `/api/admin/catalog/${f.catalogId}`,
    body: { description: 'Opis' },
    status: adminsOnly,
  },
  // A new version from one's own board: user A's board is unknown to admins.
  'PUT /api/admin/catalog/:id/content': {
    path: (f) => `/api/admin/catalog/${f.catalogId}/content`,
    body: (f) => ({ boardId: f.boardId, includePhotos: false }),
    status: { ...adminsOnly, admin: 404, superadmin: 404 },
  },
  'DELETE /api/admin/catalog/:id': {
    path: (f) => `/api/admin/catalog/${f.catalogId}`,
    status: { ...adminsOnly, admin: 204, superadmin: 404 },
  },
  'GET /api/admin/users': { status: adminsOnly },
  // Admin routes act on user A: admins manage plain accounts, superadmins everyone below.
  'POST /api/admin/users/:id/block': {
    path: (f) => `/api/admin/users/${f.ownerId}/block`,
    status: adminsOnly,
  },
  'POST /api/admin/users/:id/unblock': {
    path: (f) => `/api/admin/users/${f.ownerId}/unblock`,
    status: adminsOnly,
  },
  // Only someone who has the extra set passes it on (the admin here has not got it).
  'POST /api/admin/users/:id/extra-set': {
    path: (f) => `/api/admin/users/${f.ownerId}/extra-set`,
    body: { enabled: true },
    status: { ...adminsOnly, admin: 403 },
  },
  'POST /api/admin/users/:id/role': {
    path: (f) => `/api/admin/users/${f.ownerId}/role`,
    body: { role: 'admin' },
    status: { ...adminsOnly, admin: 403 },
  },
  // The admin deletes the account first; the superadmin then finds nothing.
  'DELETE /api/admin/users/:id': {
    path: (f) => `/api/admin/users/${f.ownerId}`,
    body: (f) => ({ email: f.ownerEmail }),
    status: { ...adminsOnly, admin: 204, superadmin: 404 },
  },
  'GET /api/admin/users/:id/data': {
    path: (f) => `/api/admin/users/${f.ownerId}/data`,
    status: adminsOnly,
  },
  'GET /api/admin/users/:id/media/:mediaId': {
    path: (f) => `/api/admin/users/${f.ownerId}/media/${f.mediaId}`,
    status: adminsOnly,
  },
  'GET /api/admin/audit': { status: adminsOnly },
  'PUT /api/admin/category-icons': {
    body: { set: 'arasaac', key: 'verb', symbol: 6061 },
    status: { ...all(403), anon: 401, admin: 200, superadmin: 200 },
  },
  // Backups (F7): set up by superadmins only; read with the token alone, which no
  // principal here has, so a session (even a superadmin's) never reads a backup.
  'GET /api/admin/backup': { status: superadminOnly },
  'PUT /api/admin/backup': { body: { recipient: RECIPIENT }, status: superadminOnly },
  'DELETE /api/admin/backup': { status: { ...superadminOnly, superadmin: 204 } },
  'GET /api/backup/index': { status: all(401) },
  'GET /api/backup/d1': { status: all(401) },
  'GET /api/backup/catalog': { status: all(401) },
  'GET /api/backup/catalog/:id/photos/:key': {
    path: (f) => `/api/backup/catalog/${f.catalogId}/photos/${CATALOG_PHOTO}`,
    status: all(401),
  },
  'GET /api/backup/users/:id': { path: (f) => `/api/backup/users/${f.ownerId}`, status: all(401) },
  'GET /api/backup/users/:id/media': {
    path: (f) => `/api/backup/users/${f.ownerId}/media`,
    status: all(401),
  },
  'GET /api/backup/users/:id/media/:mediaId': {
    path: (f) => `/api/backup/users/${f.ownerId}/media/${f.mediaId}`,
    status: all(401),
  },
  // The flag comes from D1, not from the role: admins without it are refused too.
  'GET /sym/extra/*': {
    path: '/sym/extra/manifest.json',
    status: { ...all(403), anon: 401, extra: 200 },
  },
};

async function boardFixture(call: ReturnType<typeof makeApp>['call'], owner: TestUser) {
  const api = apiAs(call, await sessionCookie(owner.id));
  const home = await api<BoardChanges>('POST', '/api/boards/home', {
    name: 'Start',
    rows: 4,
    cols: 5,
  });
  const boardId = home.body.boards[0]!.id;
  const photo = await uploadAs(call, await sessionCookie(owner.id))<{ media: { id: string } }>(
    'Dom',
    webp(32, 32),
  );
  const tile = await api<BoardChanges>('POST', `/api/boards/${boardId}/tiles`, {
    rev: 1,
    row: 0,
    col: 0,
    kind: 'word',
    label: 'jeść',
    symbol: { set: 'own', ref: photo.body.media.id },
  });
  // A share of the home board sent to the owner's own address: one received, one sent.
  await api('POST', '/api/shares', { boardId, email: owner.email });
  const shares = await api<ShareLists>('GET', '/api/shares');
  const favorite = await api<{ id: string }>('POST', '/api/favorites', {
    items: [{ label: 'dziękuję', symbol: null }],
  });
  // A catalogue entry with one photo.
  const entry = await catalogFor(env).publish({
    name: 'Katalog',
    description: '',
    package: JSON.stringify({ v: 1, name: 'Katalog', board: { rows: 1, cols: 1, tiles: [] } }),
    files: [
      {
        key: CATALOG_PHOTO,
        label: 'x',
        mime: 'image/webp',
        width: 8,
        height: 8,
        bytes: 8,
        sha256: 'x',
        data: webp(8, 8).slice().buffer,
      },
    ],
    boards: 1,
    tiles: 0,
    photos: 1,
    bytes: 8,
    publishedBy: owner.id,
  });
  if ('error' in entry) throw new Error(entry.error);
  // Board revision is 2 after the tile was added.
  return {
    boardId,
    tileId: tile.body.boards[0]!.tiles[0]!.id,
    mediaId: photo.body.media.id,
    ownerId: owner.id,
    ownerEmail: owner.email,
    receivedId: shares.body.received[0]!.id,
    sentId: shares.body.sent[0]!.id,
    catalogId: entry.id,
    favoriteId: favorite.body.id,
  } satisfies Fixture;
}

async function makePrincipals(): Promise<Record<Exclude<Principal, 'anon'>, TestUser>> {
  return {
    userA: await insertUser(),
    userB: await insertUser(),
    extra: await insertUser({ extraSet: true }),
    blocked: await insertUser({ status: 'blocked' }),
    admin: await insertUser({ role: 'admin' }),
    // Superadmin is derived from ADMIN_EMAILS on every request (see vitest.config.ts).
    superadmin: await insertUser({ role: 'superadmin', email: 'root@example.com' }),
  };
}

describe('authorization matrix', () => {
  const { app, call } = makeApp();
  const registered = app.routes
    .filter((r) => r.method !== 'ALL')
    .map((r) => `${r.method} ${r.path}`)
    .filter((key, i, all) => all.indexOf(key) === i);

  it('every registered route has a matrix row and a registry entry (and vice versa)', () => {
    const registry = Object.values(ROUTES).map((r) => `${r.method} ${r.path}`);
    expect(registered.sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(registry.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const route of Object.keys(EXPECTED)) {
    it(route, async () => {
      const users = await makePrincipals();
      const fixture = await boardFixture(call, users.userA);
      const [method, pattern] = route.split(' ') as [string, string];
      const row = EXPECTED[route]!;
      const { status } = row;
      const path = typeof row.path === 'function' ? row.path(fixture) : (row.path ?? pattern);
      const body = typeof row.body === 'function' ? row.body(fixture) : row.body;
      for (const principal of PRINCIPALS) {
        const cookie = principal === 'anon' ? undefined : await sessionCookie(users[principal].id);
        const multipart = formHeaders(cookie);
        const init: RequestInit =
          method === 'GET'
            ? { headers: cookie ? { Cookie: cookie } : {} }
            : row.form
              ? { method, headers: multipart, body: row.form() }
              : { method, headers: writeHeaders(cookie), body: JSON.stringify(body ?? {}) };
        const res = await call(path, init);
        expect(res.status, `${route} as ${principal}`).toBe(status[principal]);
      }
    });
  }
});

describe('cross-user isolation', () => {
  it("user B never sees user A's settings", async () => {
    const { call } = makeApp();
    const a = await insertUser();
    const b = await insertUser();
    const ca = await sessionCookie(a.id);
    const cb = await sessionCookie(b.id);

    const write = await call('/api/settings', {
      method: 'PATCH',
      headers: writeHeaders(ca),
      body: JSON.stringify({ returnToHome: false, searchSources: 'tiles' }),
    });
    expect(write.status).toBe(200);

    const readA = await (await call('/api/settings', { headers: { Cookie: ca } })).json();
    const readB = await (await call('/api/settings', { headers: { Cookie: cb } })).json();
    expect(readA).toMatchObject({ returnToHome: false, searchSources: 'tiles' });
    expect(readB).toMatchObject({ returnToHome: true, searchSources: 'both' });
  });

  it('no request parameter can select a vault', async () => {
    const { call } = makeApp();
    const a = await insertUser();
    const b = await insertUser();
    const cb = await sessionCookie(b.id);
    await call('/api/settings', {
      method: 'PATCH',
      headers: writeHeaders(await sessionCookie(a.id)),
      body: JSON.stringify({ returnToHome: false }),
    });
    for (const path of [
      `/api/settings?user=${a.id}`,
      `/api/settings?userId=${a.id}`,
      `/api/settings/${a.id}`,
    ]) {
      const res = await call(path, { headers: { Cookie: cb, 'X-User-Id': a.id } });
      if (res.status === 200) expect(await res.json()).toMatchObject({ returnToHome: true });
      else expect(res.status).toBe(404);
    }
  });

  it('admin list exposes no session data', async () => {
    const { call } = makeApp();
    const admin = await insertUser({ role: 'admin' });
    const res = await call('/api/admin/users', {
      headers: { Cookie: await sessionCookie(admin.id) },
    });
    const body = (await res.json()) as { users: Record<string, unknown>[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    expect(body.users.length).toBeGreaterThan(0);
    for (const u of body.users) {
      expect(Object.keys(u).sort()).toEqual(
        [
          'blockedAt',
          'boards',
          'createdAt',
          'displayName',
          'email',
          'extraSet',
          'id',
          'lastLoginAt',
          'lastSeenAt',
          'media',
          'role',
          'status',
          'storageBytes',
          'tiles',
        ].sort(),
      );
    }
  });
});
