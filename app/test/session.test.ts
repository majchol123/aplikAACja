import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_MS,
} from '../src/worker/auth/session.ts';
import { insertUser, makeApp, sessionCookie } from './helpers.ts';

describe('sessions', () => {
  it('slides on use but expires after idle and absolute limits', async () => {
    const start = Date.now();
    const t = makeApp({}, { now: start });
    const user = await insertUser();
    const cookie = await sessionCookie(user.id, start);
    const me = () => t.call('/api/me', { headers: { Cookie: cookie } });

    expect((await me()).status).toBe(200);
    // Used again after 80 days: still valid and last_seen refreshed.
    t.clock.now = start + 80 * 24 * 3600 * 1000;
    expect((await me()).status).toBe(200);
    // 80 + 80 days: within idle window thanks to the refresh.
    t.clock.now = start + 160 * 24 * 3600 * 1000;
    expect((await me()).status).toBe(200);
    // Idle for longer than 90 days.
    t.clock.now += SESSION_IDLE_MS + 1;
    expect((await me()).status).toBe(401);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .bind(user.id)
      .first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it('enforces the absolute lifetime even with constant use', async () => {
    const start = Date.now();
    const t = makeApp({}, { now: start });
    const user = await insertUser();
    const cookie = await sessionCookie(user.id, start);
    for (let day = 0; day < 365; day += 60) {
      t.clock.now = start + day * 24 * 3600 * 1000;
      expect((await t.call('/api/me', { headers: { Cookie: cookie } })).status).toBe(200);
    }
    t.clock.now = start + SESSION_ABSOLUTE_MS;
    expect((await t.call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('refreshes last_seen at most once per hour', async () => {
    const start = Date.now();
    const t = makeApp({}, { now: start });
    const user = await insertUser();
    const cookie = await sessionCookie(user.id, start);
    const lastSeen = async () =>
      (await env.DB.prepare('SELECT last_seen_at AS v FROM sessions WHERE user_id = ?')
        .bind(user.id)
        .first<{ v: number }>())!.v;
    t.clock.now = start + SESSION_TOUCH_MS - 1;
    await t.call('/api/me', { headers: { Cookie: cookie } });
    expect(await lastSeen()).toBe(start);
    t.clock.now = start + SESSION_TOUCH_MS;
    await t.call('/api/me', { headers: { Cookie: cookie } });
    expect(await lastSeen()).toBe(start + SESSION_TOUCH_MS);
  });

  it('ignores malformed tokens and cookies without the __Host- prefix', async () => {
    const t = makeApp();
    const user = await insertUser();
    const valid = (await sessionCookie(user.id)).split('=')[1]!;
    for (const cookie of [
      '__Host-relaacja_sid=short',
      `__Host-relaacja_sid=${valid}x`,
      `relaacja_sid=${valid}`,
      `__Secure-relaacja_sid=${valid}`,
    ]) {
      expect((await t.call('/api/me', { headers: { Cookie: cookie } })).status).toBe(401);
    }
  });

  it('blocks access immediately when the account is blocked', async () => {
    const t = makeApp();
    const user = await insertUser();
    const cookie = await sessionCookie(user.id);
    expect((await t.call('/api/me', { headers: { Cookie: cookie } })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET status = 'blocked' WHERE id = ?").bind(user.id).run();
    const res = await t.call('/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'blocked' });
  });
});
