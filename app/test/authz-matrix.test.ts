import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/worker/routes/registry.ts';
import type { BoardChanges } from '@relaacja/shared';
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
}

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
  const tile = await api<BoardChanges>('POST', `/api/boards/${boardId}/tiles`, {
    rev: 1,
    row: 0,
    col: 0,
    kind: 'word',
    label: 'jeść',
  });
  const photo = await uploadAs(call, await sessionCookie(owner.id))<{ media: { id: string } }>(
    'Dom',
    webp(32, 32),
  );
  // Board revision is 2 after the tile was added.
  return {
    boardId,
    tileId: tile.body.boards[0]!.tiles[0]!.id,
    mediaId: photo.body.media.id,
    ownerId: owner.id,
    ownerEmail: owner.email,
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
