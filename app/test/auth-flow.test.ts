import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetJwksCache } from '../src/worker/auth/google.ts';
import { openOAuthPayload } from '../src/worker/auth/oauth-cookie.ts';
import { fakeGoogle, validClaims, type FakeGoogle } from './fake-google.ts';
import { makeApp, setCookies, writeHeaders } from './helpers.ts';

let g: FakeGoogle;
let t: ReturnType<typeof makeApp>;

beforeEach(async () => {
  resetJwksCache();
  g = await fakeGoogle();
  t = makeApp({ fetch: g.fetch });
});

/** Runs /login, then lets "Google" answer the callback with the given claims. */
async function loginAs(
  claims: Record<string, unknown>,
  opts: { tamperState?: boolean; extraCookie?: string } = {},
) {
  const login = await t.call('/api/auth/login');
  expect(login.status).toBe(302);
  const oauth = setCookies(login)['__Host-aplikaacja_oauth']!;
  const location = new URL(login.headers.get('Location')!);
  const state = location.searchParams.get('state')!;
  const payload = (await openOAuthPayload(env.OAUTH_COOKIE_KEY, oauth.value, Date.now()))!;
  g.nextIdToken = await g.sign(validClaims({ nonce: payload.nonce, ...claims }));
  const qs = new URLSearchParams({
    code: 'auth-code',
    state: opts.tamperState ? `${state}x` : state,
  });
  const cookie = [`__Host-aplikaacja_oauth=${oauth.value}`, opts.extraCookie]
    .filter(Boolean)
    .join('; ');
  const res = await t.call(`/api/auth/callback?${qs}`, { headers: { Cookie: cookie } });
  return { login, location, payload, res };
}

describe('Google login flow', () => {
  it('redirects to Google with PKCE and a hardened state cookie', async () => {
    const { login, location, payload } = await loginAs({});
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5173/api/auth/callback',
    );
    expect(location.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get('nonce')).toBe(payload.nonce);
    const raw = setCookies(login)['__Host-aplikaacja_oauth']!.raw;
    expect(raw).toMatch(/Path=\//);
    expect(raw).toMatch(/Secure/);
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Lax/);
    expect(raw).not.toMatch(/Domain=/i);
  });

  it('creates an account and a session; the verifier reaches the token endpoint', async () => {
    const { res, payload } = await loginAs({ sub: 'new-sub', email: 'new@example.com' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(g.tokenRequests[0]!.get('code_verifier')).toBe(payload.verifier);
    const sid = setCookies(res)['__Host-aplikaacja_sid']!;
    expect(sid.raw).toMatch(/HttpOnly/);
    expect(sid.raw).toMatch(/Secure/);
    const me = await t.call('/api/me', {
      headers: { Cookie: `__Host-aplikaacja_sid=${sid.value}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      email: 'new@example.com',
      role: 'user',
      extraSet: false,
    });
    const stored = await env.DB.prepare('SELECT token_hash FROM sessions').all<{
      token_hash: string;
    }>();
    expect(stored.results.map((r) => r.token_hash)).not.toContain(sid.value);
  });

  it('bootstraps superadmins from ADMIN_EMAILS and demotes delisted ones', async () => {
    const first = await loginAs({ sub: 'root-sub', email: 'ROOT@example.com' });
    const sid = setCookies(first.res)['__Host-aplikaacja_sid']!.value;
    const me = await t.call('/api/me', { headers: { Cookie: `__Host-aplikaacja_sid=${sid}` } });
    expect(await me.json()).toMatchObject({ role: 'superadmin' });

    await loginAs({ sub: 'root-sub', email: 'changed@example.com' });
    const row = await env.DB.prepare('SELECT role FROM users WHERE google_sub = ?')
      .bind('root-sub')
      .first<{ role: string }>();
    expect(row!.role).toBe('user');
  });

  it('keeps one account per Google sub even if the e-mail changes', async () => {
    await loginAs({ sub: 'stable-sub', email: 'a@example.com' });
    await loginAs({ sub: 'stable-sub', email: 'b@example.com' });
    const rows = await env.DB.prepare('SELECT email FROM users WHERE google_sub = ?')
      .bind('stable-sub')
      .all();
    expect(rows.results).toEqual([{ email: 'b@example.com' }]);
  });

  it('rotates the session token on login', async () => {
    const first = setCookies((await loginAs({ sub: 'rot' })).res)['__Host-aplikaacja_sid']!.value;
    const second = await loginAs({ sub: 'rot' }, { extraCookie: `__Host-aplikaacja_sid=${first}` });
    const old = await t.call('/api/me', { headers: { Cookie: `__Host-aplikaacja_sid=${first}` } });
    expect(old.status).toBe(401);
    expect(setCookies(second.res)['__Host-aplikaacja_sid']!.value).not.toBe(first);
  });

  it('refuses blocked accounts without creating a session', async () => {
    await loginAs({ sub: 'blocked-sub' });
    await env.DB.prepare(
      "UPDATE users SET status = 'blocked' WHERE google_sub = 'blocked-sub'",
    ).run();
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{
      n: number;
    }>();
    const { res } = await loginAs({ sub: 'blocked-sub' });
    expect(res.headers.get('Location')).toBe('/?blad=zablokowane');
    expect(setCookies(res)['__Host-aplikaacja_sid']).toBeUndefined();
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it('rejects a state mismatch, a missing cookie and a forged token', async () => {
    expect((await loginAs({}, { tamperState: true })).res.headers.get('Location')).toBe(
      '/?blad=logowanie',
    );
    const noCookie = await t.call('/api/auth/callback?code=x&state=y');
    expect(noCookie.headers.get('Location')).toBe('/?blad=logowanie');
    const unverified = await loginAs({ email_verified: false });
    expect(unverified.res.headers.get('Location')).toBe('/?blad=logowanie');
    expect(setCookies(unverified.res)['__Host-aplikaacja_sid']).toBeUndefined();
  });

  it('maps user cancellation to a friendly error and always clears the state cookie', async () => {
    const res = await t.call('/api/auth/callback?error=access_denied');
    expect(res.headers.get('Location')).toBe('/?blad=anulowano');
    expect(setCookies(res)['__Host-aplikaacja_oauth']!.raw).toMatch(/Max-Age=0/);
  });

  it('logout removes the session; logout-all removes every device', async () => {
    const a = setCookies((await loginAs({ sub: 'multi' })).res)['__Host-aplikaacja_sid']!.value;
    const b = setCookies((await loginAs({ sub: 'multi' })).res)['__Host-aplikaacja_sid']!.value;
    const c = setCookies((await loginAs({ sub: 'multi' })).res)['__Host-aplikaacja_sid']!.value;

    const out = await t.call('/api/auth/logout', {
      method: 'POST',
      headers: writeHeaders(`__Host-aplikaacja_sid=${a}`),
    });
    expect(out.status).toBe(204);
    // Privately cached photos go too (a tablet may be shared); local storage stays.
    expect(out.headers.get('Clear-Site-Data')).toBe('"cache"');
    expect(
      (await t.call('/api/me', { headers: { Cookie: `__Host-aplikaacja_sid=${a}` } })).status,
    ).toBe(401);
    expect(
      (await t.call('/api/me', { headers: { Cookie: `__Host-aplikaacja_sid=${b}` } })).status,
    ).toBe(200);

    const all = await t.call('/api/auth/logout-all', {
      method: 'POST',
      headers: writeHeaders(`__Host-aplikaacja_sid=${b}`),
    });
    expect(all.status).toBe(204);
    expect(all.headers.get('Clear-Site-Data')).toBe('"cache"');
    expect(
      (await t.call('/api/me', { headers: { Cookie: `__Host-aplikaacja_sid=${c}` } })).status,
    ).toBe(401);
  });
});
