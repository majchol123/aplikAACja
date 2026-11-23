import { env } from 'cloudflare:workers';
import type { CategoryIcons } from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { MAX_CATEGORY_ICONS } from '../src/worker/routes/categories.ts';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

async function as(opts: Parameters<typeof insertUser>[0] = {}) {
  const { call } = makeApp();
  const user = await insertUser(opts);
  return { api: apiAs(call, await sessionCookie(user.id)), user };
}

const PUT = '/api/admin/category-icons';
const GET = '/api/symbols/category-icons';

async function audit(actor: string) {
  const { results } = await env.DB.prepare(
    'SELECT action, details FROM admin_audit WHERE actor_user_id = ?1 ORDER BY at, rowid',
  )
    .bind(actor)
    .all<{ action: string; details: string }>();
  return results.map((r) => [r.action, JSON.parse(r.details)]);
}

describe('folder pictures chosen by admins (F2 step 6)', () => {
  it('an admin sets and resets a folder picture for every account, with an audit trail', async () => {
    const admin = await as({ role: 'admin' });
    const reader = await as();

    const set = await admin.api<CategoryIcons>('PUT', PUT, {
      set: 'arasaac',
      key: 'knowledge',
      symbol: 2322,
    });
    expect(set.status).toBe(200);
    expect(set.body.arasaac).toMatchObject({ knowledge: 2322 });
    await admin.api('PUT', PUT, { set: 'arasaac', key: 'knowledge', symbol: 11375 });
    expect((await reader.api<CategoryIcons>('GET', GET)).body.arasaac).toMatchObject({
      knowledge: 11375,
    });

    const reset = await admin.api<CategoryIcons>('PUT', PUT, {
      set: 'arasaac',
      key: 'knowledge',
      symbol: null,
    });
    expect(reset.status).toBe(200);
    expect(reset.body.arasaac).not.toHaveProperty('knowledge');
    expect(await audit(admin.user.id)).toEqual([
      ['category_icon.set', { set: 'arasaac', key: 'knowledge', symbol: 2322 }],
      ['category_icon.set', { set: 'arasaac', key: 'knowledge', symbol: 11375 }],
      ['category_icon.reset', { set: 'arasaac', key: 'knowledge', symbol: null }],
    ]);
  });

  it('extra-set folders need the grant, to change and to see', async () => {
    const plainAdmin = await as({ role: 'admin' });
    const extraAdmin = await as({ role: 'admin', extraSet: true });
    const plainUser = await as();
    const extraUser = await as({ extraSet: true });

    const refused = await plainAdmin.api('PUT', PUT, { set: 'extra', key: '13', symbol: 7 });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: 'extra_set_not_enabled' });
    expect((await extraAdmin.api('PUT', PUT, { set: 'extra', key: '13', symbol: 7 })).status).toBe(
      200,
    );

    const seen = await extraUser.api<CategoryIcons>('GET', GET);
    expect(seen.body.extra).toMatchObject({ '13': 7 });
    const hidden = await plainUser.api<CategoryIcons>('GET', GET);
    expect(hidden.body).not.toHaveProperty('extra');
  });

  it('validates set, key and symbol', async () => {
    const { api } = await as({ role: 'admin' });
    for (const body of [
      { set: 'own', key: 'verb', symbol: 1 },
      { set: 'arasaac', key: 'Verb', symbol: 1 },
      { set: 'arasaac', key: '__proto__', symbol: 1 },
      { set: 'arasaac', key: 'x'.repeat(101), symbol: 1 },
      { set: 'arasaac', key: 'verb', symbol: -1 },
      { set: 'arasaac', key: 'verb', symbol: 1.5 },
      { set: 'arasaac', key: 'verb', symbol: '1' },
      { set: 'arasaac', key: 'verb' },
      { set: 'arasaac', key: 'verb', symbol: 1, extra: true },
    ]) {
      expect((await api('PUT', PUT, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('caps the number of chosen pictures; changing an existing one always works', async () => {
    const { api } = await as({ role: 'admin' });
    await env.DB.prepare('DELETE FROM category_icons').run();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?1)
       INSERT INTO category_icons (symbol_set, category_key, symbol_id, updated_at)
       SELECT 'arasaac', 'filler ' || i, i, 0 FROM n`,
    )
      .bind(MAX_CATEGORY_ICONS)
      .run();
    const full = await api('PUT', PUT, { set: 'arasaac', key: 'one more', symbol: 1 });
    expect(full.status).toBe(422);
    expect(full.body).toEqual({ error: 'quota_exceeded' });
    expect((await api('PUT', PUT, { set: 'arasaac', key: 'filler 7', symbol: 70 })).status).toBe(
      200,
    );
  });
});
