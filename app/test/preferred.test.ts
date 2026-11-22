import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { PREFERRED_LIMIT, type PreferredSymbols } from '@relaacja/shared';
import { describe, expect, it } from 'vitest';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

async function setup(opts: { extraSet?: boolean } = {}) {
  const { call } = makeApp();
  const user = await insertUser(opts);
  return { api: apiAs(call, await sessionCookie(user.id)), user };
}

const arasaac = (ref: string) => ({ set: 'arasaac', ref });

describe('preferred symbol variants (PLAN §2.2)', () => {
  it('stores one choice per normalized word, the last one wins', async () => {
    const { api } = await setup();
    expect((await api<PreferredSymbols>('GET', '/api/symbols/preferred')).body).toEqual({
      items: [],
    });

    const put = await api('PUT', '/api/symbols/preferred', {
      word: 'Jabłko',
      symbol: arasaac('2462'),
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ word: 'jablko', symbol: arasaac('2462') });
    await api('PUT', '/api/symbols/preferred', { word: 'jablko', symbol: arasaac('8340') });
    await api('PUT', '/api/symbols/preferred', { word: 'dzień dobry', symbol: arasaac('6970') });

    const list = await api<PreferredSymbols>('GET', '/api/symbols/preferred');
    expect(list.body.items).toEqual([
      { word: 'dzien dobry', symbol: arasaac('6970') },
      { word: 'jablko', symbol: arasaac('8340') },
    ]);
  });

  it('validates the word and symbol, and the extra set needs the grant', async () => {
    const { api } = await setup();
    for (const body of [
      { word: '…', symbol: arasaac('1') },
      { word: 'pies', symbol: { set: 'arasaac', ref: '../x' } },
      { word: 'pies', symbol: { set: 'own', ref: '1' } },
      { word: 'x'.repeat(81), symbol: arasaac('1') },
      { word: 'pies', symbol: arasaac('1'), extra: true },
    ]) {
      expect((await api('PUT', '/api/symbols/preferred', body)).status).toBe(400);
    }
    const extra = { word: 'pies', symbol: { set: 'extra', ref: '12' } };
    expect((await api('PUT', '/api/symbols/preferred', extra)).status).toBe(403);
    const granted = await setup({ extraSet: true });
    expect((await granted.api('PUT', '/api/symbols/preferred', extra)).status).toBe(200);
  });

  it('caps the number of words, but replacing a choice still works at the cap', async () => {
    const { api, user } = await setup();
    await api('PUT', '/api/symbols/preferred', { word: 'kot', symbol: arasaac('1') });
    await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
      // The counter is what the quota check reads (no table scan): pretend the vault is full.
      state.storage.sql.exec('UPDATE vault_meta SET preferred = ?', PREFERRED_LIMIT);
    });
    const fresh = await api('PUT', '/api/symbols/preferred', {
      word: 'pies',
      symbol: arasaac('2'),
    });
    expect(fresh.status).toBe(422);
    expect(fresh.body).toEqual({ error: 'quota_exceeded' });
    const replaced = await api('PUT', '/api/symbols/preferred', {
      word: 'kot',
      symbol: arasaac('3'),
    });
    expect(replaced.status).toBe(200);
  });

  it('keeps the row counter in step with the table', async () => {
    const { api, user } = await setup();
    for (const word of ['a1', 'a2', 'a3', 'a2']) {
      await api('PUT', '/api/symbols/preferred', { word, symbol: arasaac('5') });
    }
    const counts = await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
      const sql = state.storage.sql;
      return {
        meta: sql.exec<{ preferred: number }>('SELECT preferred FROM vault_meta').one().preferred,
        rows: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM preferred_symbols').one().n,
      };
    });
    expect(counts).toEqual({ meta: 3, rows: 3 });
  });
});
