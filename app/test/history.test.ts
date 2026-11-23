import { PHRASE_LIMITS, type HistoryList } from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

const { call } = makeApp();

async function account(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}

const say = (...labels: string[]) => labels.map((label) => ({ label, symbol: null }));
const texts = (list: HistoryList) => list.entries.map((e) => e.items.map((i) => i.label).join(' '));

describe('history of utterances on the account', () => {
  it('keeps the newest, the same words once, and every device sees it', async () => {
    const user = await account();
    expect((await user.api<HistoryList>('GET', '/api/history')).body).toEqual({ entries: [] });
    const now = Date.now();
    const first = await user.api<HistoryList>('POST', '/api/history', {
      entries: [
        { at: now - 3000, items: say('chcę', 'pić') },
        { at: now - 2000, items: say('dzień dobry') },
      ],
    });
    expect(first.status).toBe(200);
    expect(texts(first.body)).toEqual(['dzień dobry', 'chcę pić']);
    // Another device sends the same words later, and one from the future.
    const second = await user.api<HistoryList>('POST', '/api/history', {
      entries: [
        { at: now - 1000, items: say('chcę', 'pić') },
        { at: now + 3_600_000, items: say('tak') },
      ],
    });
    expect(texts(second.body)).toEqual(['tak', 'chcę pić', 'dzień dobry']);
    expect(second.body.entries[0]!.at).toBeLessThanOrEqual(Date.now());
    // An older copy does not move a phrase back.
    await user.api('POST', '/api/history', { entries: [{ at: 1, items: say('tak') }] });
    const list = (await user.api<HistoryList>('GET', '/api/history')).body;
    expect(texts(list)).toEqual(['tak', 'chcę pić', 'dzień dobry']);
    // Nobody else sees it.
    const other = await account();
    expect((await other.api<HistoryList>('GET', '/api/history')).body.entries).toEqual([]);
  });

  it('holds at most the newest PHRASE_LIMITS.historySize', async () => {
    const user = await account();
    const n = PHRASE_LIMITS.historySize;
    for (let batch = 0; batch < 2; batch++) {
      const entries = Array.from({ length: n }, (_, i) => ({
        at: 1000 + batch * n + i,
        items: say(`słowo ${batch * n + i}`),
      }));
      expect((await user.api('POST', '/api/history', { entries })).status).toBe(200);
    }
    const list = (await user.api<HistoryList>('GET', '/api/history')).body;
    expect(list.entries).toHaveLength(n);
    expect(texts(list)[0]).toBe(`słowo ${2 * n - 1}`);
    expect(texts(list).at(-1)).toBe(`słowo ${n}`);
  });

  it('drops extra-set symbols without the grant, keeps them with it', async () => {
    const items = [{ label: 'kot', symbol: { set: 'extra', ref: '12' } }];
    const plain = await account();
    const kept = await plain.api<HistoryList>('POST', '/api/history', {
      entries: [{ at: 1, items }],
    });
    expect(kept.body.entries[0]!.items).toEqual([{ label: 'kot', symbol: null }]);
    const granted = await account({ extraSet: true });
    const full = await granted.api<HistoryList>('POST', '/api/history', {
      entries: [{ at: 1, items }],
    });
    expect(full.body.entries[0]!.items).toEqual(items);
  });

  it('is cleared on request; switched off, it is forgotten and nothing is kept', async () => {
    const user = await account();
    await user.api('POST', '/api/history', { entries: [{ at: 1, items: say('tak') }] });
    expect((await user.api('DELETE', '/api/history')).status).toBe(204);
    expect((await user.api<HistoryList>('GET', '/api/history')).body.entries).toEqual([]);

    await user.api('POST', '/api/history', { entries: [{ at: 2, items: say('nie') }] });
    expect((await user.api('PATCH', '/api/settings', { keepHistory: false })).status).toBe(200);
    expect((await user.api<HistoryList>('GET', '/api/history')).body.entries).toEqual([]);
    const ignored = await user.api<HistoryList>('POST', '/api/history', {
      entries: [{ at: 3, items: say('może') }],
    });
    expect(ignored.body.entries).toEqual([]);
    await user.api('PATCH', '/api/settings', { keepHistory: true });
    expect((await user.api<HistoryList>('GET', '/api/history')).body.entries).toEqual([]);
  });

  it('refuses malformed batches', async () => {
    const user = await account();
    const post = (body: unknown) => user.api('POST', '/api/history', body);
    expect((await post({})).status).toBe(400);
    expect((await post({ entries: [] })).status).toBe(400);
    expect((await post({ entries: [{ at: -1, items: say('a') }] })).status).toBe(400);
    expect((await post({ entries: [{ at: 1, items: [] }] })).status).toBe(400);
    expect(
      (
        await post({
          entries: Array.from({ length: PHRASE_LIMITS.historySize + 1 }, (_, i) => ({
            at: i,
            items: say('a'),
          })),
        })
      ).status,
    ).toBe(400);
  });

  it('is not part of the admin data view', async () => {
    const user = await account();
    await user.api('POST', '/api/history', {
      entries: [{ at: 1, items: say('tajemnica') }],
    });
    const admin = await account({ role: 'admin' });
    const view = await call(`/api/admin/users/${user.id}/data`, {
      headers: { Cookie: admin.cookie },
    });
    expect(view.status).toBe(200);
    expect(await view.text()).not.toContain('tajemnica');
  });
});
