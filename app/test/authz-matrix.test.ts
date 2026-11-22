import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/worker/routes/registry.ts';
import { insertUser, makeApp, sessionCookie, writeHeaders, type TestUser } from './helpers.ts';

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

const EXPECTED: Record<
  string,
  { body?: unknown; path?: string; status: Record<Principal, number> }
> = {
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
  'GET /api/admin/users': {
    status: { ...all(403), anon: 401, admin: 200, superadmin: 200 },
  },
  // The flag comes from D1, not from the role: admins without it are refused too.
  'GET /sym/extra/*': {
    path: '/sym/extra/manifest.json',
    status: { ...all(403), anon: 401, extra: 200 },
  },
};

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
      const [method, pattern] = route.split(' ') as [string, string];
      const { body, path = pattern, status } = EXPECTED[route]!;
      for (const principal of PRINCIPALS) {
        const cookie = principal === 'anon' ? undefined : await sessionCookie(users[principal].id);
        const init: RequestInit =
          method === 'GET'
            ? { headers: cookie ? { Cookie: cookie } : {} }
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
    const body = (await res.json()) as { users: Record<string, unknown>[] };
    expect(body.users.length).toBeGreaterThan(0);
    for (const u of body.users) {
      expect(Object.keys(u).sort()).toEqual(
        [
          'createdAt',
          'displayName',
          'email',
          'id',
          'lastLoginAt',
          'extraSet',
          'role',
          'status',
          'storageBytes',
        ].sort(),
      );
    }
  });
});
