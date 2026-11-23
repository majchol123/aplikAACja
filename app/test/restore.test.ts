import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { RESTORE_WINDOW_MS, type BoardChanges, type BoardTree } from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { apiAs, insertUser, makeApp, sessionCookie } from './helpers.ts';

/**
 * Point-in-time recovery of an account (PLAN §6). Cloudflare keeps no SQLite history in
 * local development, so the restore itself is checked on staging; here: who may ask for
 * it, the checks before anything happens, and step 3 that runs on the restored vault.
 */
const { call } = makeApp();
const DAY_MS = 24 * 3600 * 1000;

async function as(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}

async function audited(target: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT action FROM admin_audit WHERE target_user_id = ?1 ORDER BY rowid',
  )
    .bind(target)
    .all<{ action: string }>();
  return results.map((r) => r.action);
}

const restore = (admin: Awaited<ReturnType<typeof as>>, id: string, body: unknown) =>
  admin.api<{ error?: string }>('POST', `/api/admin/users/${id}/restore`, body);

describe('restoring an account to an earlier state', () => {
  it('is for superadmins, also on their own account, and refuses before changing anything', async () => {
    const createdAt = Date.now() - 2 * DAY_MS; // accounts with a past to go back to
    const root = await as({ role: 'superadmin', email: 'root@example.com', createdAt });
    const admin = await as({ role: 'admin', createdAt });
    const user = await as({ createdAt });
    const otherRoot = await as({ email: 'second@example.com', createdAt }); // by ADMIN_EMAILS
    const deleting = await as({ status: 'deleting', createdAt });
    const hourAgo = Date.now() - 3600 * 1000;

    expect((await restore(admin, user.id, { at: hourAgo, email: user.email })).status).toBe(403);
    expect(
      (await restore(root, otherRoot.id, { at: hourAgo, email: otherRoot.email })).status,
    ).toBe(403);
    expect((await restore(root, deleting.id, { at: hourAgo, email: deleting.email })).status).toBe(
      409,
    );
    expect((await restore(root, user.id, { at: hourAgo })).status).toBe(400);
    const wrong = await restore(root, user.id, { at: hourAgo, email: root.email });
    expect([wrong.status, wrong.body.error]).toEqual([422, 'confirmation_mismatch']);
    const young = await as({ createdAt: hourAgo + 60_000 });
    for (const [target, at] of [
      [user, Date.now() + 60_000],
      [user, Date.now() - RESTORE_WINDOW_MS + 60_000],
      [young, hourAgo], // before the account existed: only an empty vault
    ] as const) {
      const res = await restore(root, target.id, { at, email: target.email.toUpperCase() });
      expect([res.status, res.body.error]).toEqual([422, 'out_of_range']);
    }
    // Locally there is no history to go back to: nothing happens and nothing is recorded.
    for (const target of [user, root]) {
      const res = await restore(root, target.id, { at: hourAgo, email: target.email });
      expect([res.status, res.body.error]).toEqual([503, 'restore_unavailable']);
      expect(await audited(target.id)).toEqual([]);
    }
  });

  it('a failed first step leaves the vault as it was', async () => {
    const user = await as();
    await user.api('POST', '/api/boards/home', { name: 'Start', rows: 2, cols: 2 });
    await runInDurableObject(vaultFor(env, user.id), async (vault: UserVault, state) => {
      expect(await vault.prepareRestore(Date.now() - 60_000)).toBeNull();
      expect(state.storage.kv.get('restore-pending')).toBeUndefined();
    });
    expect((await user.api('GET', '/api/boards')).status).toBe(200);
  });

  it('the restored tree is newer than anything a device saw: new ETag, higher revisions', async () => {
    const user = await as();
    const home = await user.api<BoardChanges>('POST', '/api/boards/home', {
      name: 'Start',
      rows: 2,
      cols: 2,
    });
    const board = home.body.boards[0]!;
    await user.api('PATCH', `/api/boards/${board.id}`, { rev: board.rev, name: 'Dom' });
    const before = await user.api<BoardTree>('GET', '/api/boards');
    const etag = before.res.headers.get('ETag')!;
    const rev = before.body.boards[0]!.rev;
    const vault = vaultFor(env, user.id);

    // Not restarted yet (the marker of step 1 is still there): step 3 refuses.
    await runInDurableObject(vault, (instance: UserVault, state) => {
      state.storage.kv.put('restore-pending', 1);
      expect(() => instance.finishRestore(rev)).toThrow('not restarted');
      state.storage.kv.delete('restore-pending');
    });

    const totals = await vault.finishRestore(rev);
    expect(totals.boards).toBe(1);
    const after = await user.api<BoardTree>('GET', '/api/boards', undefined, {
      'If-None-Match': etag,
    });
    expect(after.status).toBe(200);
    expect(after.res.headers.get('ETag')).not.toBe(etag);
    expect(after.body.boards[0]!.rev).toBe(2 * rev);
    // A device still holding the old revision gets a conflict, not an overwrite.
    const stale = await user.api('PATCH', `/api/boards/${board.id}`, { rev, name: 'Stary' });
    expect(stale.status).toBe(409);
  });
});
