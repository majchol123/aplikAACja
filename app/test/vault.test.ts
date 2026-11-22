import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DEFAULT_SETTINGS } from '@relaacja/shared';
import { describe, expect, it } from 'vitest';
import { VAULT_MIGRATIONS, migrateVault } from '../src/worker/vault/schema.ts';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { insertUser, makeApp, sessionCookie, writeHeaders } from './helpers.ts';

describe('UserVault', () => {
  it('migrates lazily to the latest schema and is idempotent', async () => {
    const stub = vaultFor(env, 'vault-migrate');
    expect(await stub.schemaVersion()).toBe(VAULT_MIGRATIONS.length);
    await runInDurableObject(stub, (_instance: UserVault, state) => {
      expect(migrateVault(state.storage)).toBe(VAULT_MIGRATIONS.length);
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .toArray()
        .map((r) => r.name);
      for (const t of [
        'boards',
        'tiles',
        'media',
        'settings',
        'preferred_symbols',
        'phrase_history',
        'favorites',
      ]) {
        expect(tables).toContain(t);
      }
    });
  });

  it('returns defaults, persists patches and survives invalid stored values', async () => {
    const stub = vaultFor(env, 'vault-settings');
    expect(await stub.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await stub.updateSettings({ returnToHome: false })).toEqual({
      ...DEFAULT_SETTINGS,
      returnToHome: false,
    });
    await runInDurableObject(stub, (_i: UserVault, state) => {
      state.storage.sql.exec(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('searchSources', '\"bogus\"')",
      );
    });
    expect(await stub.getSettings()).toEqual({ ...DEFAULT_SETTINGS, returnToHome: false });
  });

  it('deleteAll wipes the vault', async () => {
    const stub = vaultFor(env, 'vault-delete');
    await stub.updateSettings({ returnToHome: false });
    await stub.deleteAll();
    await runInDurableObject(stub, (_i: UserVault, state) => {
      const n = state.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'",
        )
        .one().n;
      expect(n).toBe(0);
    });
  });

  it('rate-limits bursts of writes per user', async () => {
    const t = makeApp();
    const user = await insertUser();
    const cookie = await sessionCookie(user.id);
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      const res = await t.call('/api/settings', {
        method: 'PATCH',
        headers: writeHeaders(cookie),
        body: JSON.stringify({ returnToHome: i % 2 === 0 }),
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(120);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('settings API validation', () => {
  it('rejects unknown keys, bad JSON and the extra set without the grant', async () => {
    const t = makeApp();
    const user = await insertUser();
    const cookie = await sessionCookie(user.id);
    const send = (body: string) =>
      t.call('/api/settings', { method: 'PATCH', headers: writeHeaders(cookie), body });
    expect((await send('{"__proto__":{"x":1}}')).status).toBe(400);
    expect((await send('{"role":"admin"}')).status).toBe(400);
    expect((await send('not json')).status).toBe(400);
    expect((await send('{"activeSets":["extra"]}')).status).toBe(403);

    const granted = await insertUser({ extraSet: true });
    const ok = await t.call('/api/settings', {
      method: 'PATCH',
      headers: writeHeaders(await sessionCookie(granted.id)),
      body: '{"activeSets":["extra","arasaac"]}',
    });
    expect(ok.status).toBe(200);
  });
});
