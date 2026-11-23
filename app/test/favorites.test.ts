import type { Favorite, FavoriteList } from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

const { call } = makeApp();

async function account(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  return { ...user, api: apiAs(call, await sessionCookie(user.id)) };
}

const phrase = (...words: string[]) =>
  words.map((label) => ({ label, symbol: { set: 'arasaac', ref: '2462' } }));

describe('favourite phrases (F3)', () => {
  it('are saved once, kept in order and removed', async () => {
    const user = await account();
    const first = await user.api<Favorite>('POST', '/api/favorites', {
      items: phrase('chcę', 'pić'),
    });
    expect(first.status).toBe(201);
    await user.api('POST', '/api/favorites', {
      items: [{ label: 'dzień dobry', symbol: null }],
    });
    // The same words again: the saved phrase comes back, nothing is added.
    const again = await user.api<Favorite>('POST', '/api/favorites', {
      items: phrase('chcę', 'pić'),
    });
    expect(again.body.id).toBe(first.body.id);
    const list = await user.api<FavoriteList>('GET', '/api/favorites');
    expect(list.body.favorites.map((f) => f.items.map((i) => i.label).join(' '))).toEqual([
      'chcę pić',
      'dzień dobry',
    ]);
    expect((await user.api('DELETE', `/api/favorites/${first.body.id}`)).status).toBe(204);
    expect((await user.api('DELETE', `/api/favorites/${first.body.id}`)).status).toBe(404);
    expect((await user.api<FavoriteList>('GET', '/api/favorites')).body.favorites).toHaveLength(1);

    // Another account sees none of them.
    const other = await account();
    expect((await other.api<FavoriteList>('GET', '/api/favorites')).body.favorites).toEqual([]);
  });

  it('validates phrases and keeps the extra set to accounts that have it', async () => {
    const user = await account();
    for (const items of [
      [],
      [{ label: '', symbol: null }],
      phrase(...Array.from({ length: 31 }, (_, i) => `w${i}`)),
      [{ label: 'x', symbol: { set: 'own', ref: 'nope' } }],
    ]) {
      expect((await user.api('POST', '/api/favorites', { items })).status).toBe(400);
    }
    const extra = [{ label: 'chleb', symbol: { set: 'extra', ref: '5' } }];
    expect((await user.api('POST', '/api/favorites', { items: extra })).status).toBe(403);
    const granted = await account({ extraSet: true });
    expect((await granted.api('POST', '/api/favorites', { items: extra })).status).toBe(201);
  });
});
