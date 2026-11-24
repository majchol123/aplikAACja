import { env } from 'cloudflare:workers';
import {
  addDays,
  USAGE_LIMITS,
  utcDay,
  type AdminUsage,
  type AdminUser,
  type AdminUserList,
  type UsageList,
} from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { apiAs, insertUser, makeApp, sessionCookie, type TestClock } from './helpers.ts';

const clock: TestClock = { now: Date.now() };
const { call } = makeApp({}, clock);
/** Past the one-report-a-minute throttle. */
const later = () => (clock.now += USAGE_LIMITS.minIntervalMs + 1);

async function account(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id, clock.now);
  return { ...user, cookie, api: apiAs(call, cookie) };
}

const today = () => utcDay(clock.now);

async function rows(userId: string) {
  const { results } = await env.DB.prepare(
    'SELECT day, utterances, tiles FROM usage_daily WHERE user_id = ?1 ORDER BY day',
  )
    .bind(userId)
    .all();
  return results;
}

describe('usage counters (statistics v2)', () => {
  it('adds up per day and shows the account its own counts', async () => {
    const user = await account();
    const first = await user.api('POST', '/api/usage', {
      days: [{ day: today(), utterances: 2, tiles: 5 }],
    });
    expect(first.status).toBe(204);
    later();
    const yesterday = addDays(today(), -1);
    await user.api('POST', '/api/usage', {
      days: [
        { day: yesterday, utterances: 3, tiles: 0 },
        { day: today(), utterances: 1, tiles: 1 },
      ],
    });
    const list = await user.api<UsageList>('GET', '/api/usage');
    expect(list.body.days).toEqual([
      { day: yesterday, utterances: 3, tiles: 0 },
      { day: today(), utterances: 3, tiles: 6 },
    ]);
    // Somebody else's counters are not in the list.
    const other = await account();
    expect((await other.api<UsageList>('GET', '/api/usage')).body.days).toEqual([]);
  });

  it('takes one report a minute; a refused one adds nothing', async () => {
    const user = await account();
    const days = [{ day: today(), utterances: 1, tiles: 1 }];
    expect((await user.api('POST', '/api/usage', { days })).status).toBe(204);
    const again = await user.api('POST', '/api/usage', { days });
    expect(again).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
    expect(await rows(user.id)).toEqual([{ day: today(), utterances: 1, tiles: 1 }]);
  });

  it('drops days a device may no longer send and refuses malformed reports', async () => {
    const user = await account();
    const old = addDays(today(), -(USAGE_LIMITS.daysBack + 1));
    const ahead = addDays(today(), 2);
    const dropped = await user.api('POST', '/api/usage', {
      days: [
        { day: old, utterances: 4, tiles: 4 },
        { day: ahead, utterances: 4, tiles: 4 },
      ],
    });
    expect(dropped.status).toBe(204);
    expect(await rows(user.id)).toEqual([]);
    for (const days of [
      [{ day: '2026-02-30', utterances: 1, tiles: 1 }],
      [{ day: today(), utterances: USAGE_LIMITS.maxUtterances + 1, tiles: 0 }],
      [{ day: today(), utterances: 1.5, tiles: 0 }],
      [{ day: today(), utterances: 1, tiles: 0, words: ['tak'] }],
      [
        { day: today(), utterances: 1, tiles: 0 },
        { day: today(), utterances: 1, tiles: 0 },
      ],
      [],
    ]) {
      expect((await user.api('POST', '/api/usage', { days })).status).toBe(400);
    }
  });

  it('caps a day of one account', async () => {
    const user = await account();
    await env.DB.prepare(
      'INSERT INTO usage_daily (user_id, day, utterances, tiles) VALUES (?1, ?2, ?3, ?4)',
    )
      .bind(user.id, today(), USAGE_LIMITS.maxUtterances - 1, USAGE_LIMITS.maxTiles)
      .run();
    await user.api('POST', '/api/usage', { days: [{ day: today(), utterances: 5, tiles: 5 }] });
    expect(await rows(user.id)).toEqual([
      { day: today(), utterances: USAGE_LIMITS.maxUtterances, tiles: USAGE_LIMITS.maxTiles },
    ]);
  });

  it('switched off: deletes the counts and stores nothing until switched on again', async () => {
    const user = await account();
    const days = [{ day: today(), utterances: 1, tiles: 2 }];
    await user.api('POST', '/api/usage', { days });
    expect((await user.api('PATCH', '/api/settings', { usageStats: false })).status).toBe(200);
    const flag = () =>
      env.DB.prepare('SELECT usage_stats AS on_ FROM users WHERE id = ?1')
        .bind(user.id)
        .first<{ on_: number }>();
    expect((await flag())?.on_).toBe(0);
    expect(await rows(user.id)).toEqual([]);
    later();
    expect((await user.api('POST', '/api/usage', { days })).status).toBe(204);
    expect(await rows(user.id)).toEqual([]);
    expect((await user.api<{ usageStats: boolean }>('GET', '/api/settings')).body.usageStats).toBe(
      false,
    );

    await user.api('PATCH', '/api/settings', { usageStats: true });
    expect((await flag())?.on_).toBe(1);
    later();
    await user.api('POST', '/api/usage', { days });
    expect(await rows(user.id)).toEqual([{ day: today(), utterances: 1, tiles: 2 }]);
  });

  it('forgets counts older than the retention period', async () => {
    const user = await account();
    const expired = addDays(today(), -(USAGE_LIMITS.retentionDays + 1));
    const kept = addDays(today(), -USAGE_LIMITS.retentionDays);
    for (const day of [expired, kept]) {
      await env.DB.prepare(
        'INSERT INTO usage_daily (user_id, day, utterances, tiles) VALUES (?1, ?2, 1, 1)',
      )
        .bind(user.id, day)
        .run();
    }
    // Any account's report clears every account's expired days.
    const other = await account();
    await other.api('POST', '/api/usage', { days: [{ day: today(), utterances: 1, tiles: 0 }] });
    expect((await rows(user.id)).map((r) => r.day)).toEqual([kept]);
  });

  it('shows administrators the totals per account and per day', async () => {
    const admin = await account({ role: 'admin' });
    const before = (await admin.api<AdminUsage>('GET', '/api/admin/usage')).body;
    const a = await account();
    const b = await account();
    const lastWeek = addDays(today(), -USAGE_LIMITS.daysBack);
    await a.api('POST', '/api/usage', {
      days: [
        { day: lastWeek, utterances: 10, tiles: 20 },
        { day: today(), utterances: 1, tiles: 2 },
      ],
    });
    await b.api('POST', '/api/usage', { days: [{ day: today(), utterances: 3, tiles: 4 }] });
    await b.api('PATCH', '/api/settings', { usageStats: false });

    const users = (await admin.api<AdminUserList>('GET', '/api/admin/users')).body.users;
    const find = (id: string) => users.find((u) => u.id === id) as AdminUser;
    expect(find(a.id)).toMatchObject({
      usageStats: true,
      utterancesWeek: 1,
      utterancesMonth: 11,
      tilesWeek: 2,
      tilesMonth: 22,
    });
    expect(find(b.id)).toMatchObject({ usageStats: false, utterancesMonth: 0, tilesMonth: 0 });

    const after = (await admin.api<AdminUsage>('GET', '/api/admin/usage')).body;
    expect(after.from).toBe(addDays(today(), -(USAGE_LIMITS.adminDays - 1)));
    const on = (usage: AdminUsage, day: string) =>
      usage.days.find((d) => d.day === day) ?? { utterances: 0, tiles: 0, accounts: 0 };
    expect(on(after, today()).utterances - on(before, today()).utterances).toBe(1);
    expect(on(after, today()).accounts - on(before, today()).accounts).toBe(1);
    expect(on(after, lastWeek).tiles - on(before, lastWeek).tiles).toBe(20);
    expect((await a.api('GET', '/api/admin/usage')).status).toBe(403);
  });
});

describe('deleting the own account', () => {
  it('needs the own address, then removes the account, its sessions and counters', async () => {
    const user = await account({ email: 'Self.Delete@example.com' });
    const otherDevice = apiAs(call, await sessionCookie(user.id, clock.now));
    await user.api('POST', '/api/boards/home', { rows: 2, cols: 2 });
    await user.api('POST', '/api/usage', { days: [{ day: today(), utterances: 1, tiles: 1 }] });

    const wrong = await user.api('DELETE', '/api/me', { email: 'someone@example.com' });
    expect(wrong).toMatchObject({ status: 422, body: { error: 'confirmation_mismatch' } });
    expect((await user.api('DELETE', '/api/me')).status).toBe(400);
    expect((await user.api('GET', '/api/me')).status).toBe(200);

    const done = await user.api('DELETE', '/api/me', { email: ' self.delete@EXAMPLE.com ' });
    expect(done.status).toBe(204);
    expect(done.res.headers.get('Clear-Site-Data')).toBe('"cache"');
    expect(done.res.headers.getSetCookie().join(';')).toMatch(/__Host-aplikaacja_sid=;/);
    expect((await user.api('GET', '/api/me')).status).toBe(401);
    expect((await otherDevice('GET', '/api/me')).status).toBe(401);
    for (const table of ['users', 'sessions', 'usage_daily']) {
      const column = table === 'users' ? 'id' : 'user_id';
      const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?1`)
        .bind(user.id)
        .first<{ n: number }>();
      expect(left?.n, table).toBe(0);
    }
    const audit = await env.DB.prepare(
      'SELECT action, actor_user_id AS actor, details FROM admin_audit WHERE target_user_id = ?1',
    )
      .bind(user.id)
      .all();
    expect(audit.results).toEqual([{ action: 'user.delete_self', actor: user.id, details: '{}' }]);
  });

  it('is not for superadmins, whose role comes from ADMIN_EMAILS', async () => {
    const root = await account({ role: 'superadmin', email: 'second@example.com' });
    const refused = await root.api('DELETE', '/api/me', { email: 'second@example.com' });
    expect(refused).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect((await root.api('GET', '/api/me')).status).toBe(200);
  });
});
