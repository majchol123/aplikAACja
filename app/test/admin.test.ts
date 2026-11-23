import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type {
  AdminUser,
  AdminUserData,
  AdminUserList,
  AuditPage,
  BoardChanges,
  Me,
} from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import { apiAs, insertUser, makeApp, sessionCookie, uploadAs } from './helpers.ts';
import { webp } from './images.ts';

const { call } = makeApp();

async function as(opts: Parameters<typeof insertUser>[0] = {}) {
  const user = await insertUser(opts);
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}

async function auditOf(target: string) {
  const { results } = await env.DB.prepare(
    'SELECT action, actor_user_id AS actor, details FROM admin_audit WHERE target_user_id = ?1 ORDER BY rowid',
  )
    .bind(target)
    .all<{ action: string; actor: string; details: string }>();
  return results.map((r) => [r.action, r.actor, JSON.parse(r.details)]);
}

async function listed(admin: Awaited<ReturnType<typeof as>>, id: string): Promise<AdminUser> {
  const list = await admin.api<AdminUserList>('GET', '/api/admin/users');
  const user = list.body.users.find((u) => u.id === id);
  if (!user) throw new Error('not listed');
  return user;
}

/** A home board with one tile and one photo in the account's vault. */
async function withContent(user: Awaited<ReturnType<typeof as>>) {
  const home = await user.api<BoardChanges>('POST', '/api/boards/home', {
    name: 'Start',
    rows: 2,
    cols: 2,
  });
  const boardId = home.body.boards[0]!.id;
  await user.api('POST', `/api/boards/${boardId}/tiles`, {
    rev: 1,
    row: 0,
    col: 0,
    kind: 'word',
    label: 'pić',
  });
  const photo = await uploadAs(call, user.cookie)<{ media: { id: string } }>('Dom', webp(16, 16));
  return { boardId, mediaId: photo.body.media.id };
}

describe('admin panel: account list and statistics v1', () => {
  it('copies vault counters to D1 and never sends them to the account itself', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    const home = await user.api<Record<string, unknown>>('POST', '/api/boards/home', {
      name: 'Start',
      rows: 2,
      cols: 2,
    });
    expect(home.body).not.toHaveProperty('totals');
    const photo = await uploadAs(call, user.cookie)<Record<string, unknown>>('Dom', webp(16, 16));
    expect(photo.body).not.toHaveProperty('totals');
    expect(await listed(admin, user.id)).toMatchObject({
      boards: 1,
      tiles: 0,
      media: 1,
      storageBytes: expect.any(Number),
    });
    expect((await listed(admin, user.id)).storageBytes).toBeGreaterThan(0);
  });

  it('fills the counters of accounts that only read their boards', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    await withContent(user);
    await env.DB.prepare(
      'UPDATE users SET boards_count = 0, tiles_count = 0, media_count = 0, storage_bytes = 0 WHERE id = ?1',
    )
      .bind(user.id)
      .run();
    expect(await listed(admin, user.id)).toMatchObject({ boards: 0, tiles: 0, media: 0 });
    expect((await user.api('GET', '/api/boards')).status).toBe(200);
    expect(await listed(admin, user.id)).toMatchObject({ boards: 1, tiles: 1, media: 1 });
  });

  it('shows the effective role, the latest session activity and block time', async () => {
    const admin = await as({ role: 'admin' });
    // Listed in ADMIN_EMAILS (vitest.config.ts) although D1 still says user.
    const listedRoot = await as({ email: 'second@example.com' });
    expect((await listed(admin, listedRoot.id)).role).toBe('superadmin');

    const user = await insertUser();
    expect(await listed(admin, user.id)).toMatchObject({ lastSeenAt: null, blockedAt: null });
    await sessionCookie(user.id, 1_000);
    await sessionCookie(user.id, 5_000);
    expect((await listed(admin, user.id)).lastSeenAt).toBe(5_000);
  });
});

describe('admin panel: who may manage whom', () => {
  it('admins manage plain accounts only; superadmins also admins; nobody a superadmin or self', async () => {
    const admin = await as({ role: 'admin' });
    const otherAdmin = await as({ role: 'admin' });
    const root = await as({ role: 'superadmin', email: 'root@example.com' });
    const second = await as({ email: 'second@example.com' }); // superadmin by ADMIN_EMAILS
    const user = await as();

    const block = (who: typeof admin, target: string) =>
      who.api('POST', `/api/admin/users/${target}/block`);
    expect((await block(admin, otherAdmin.id)).status).toBe(403);
    expect((await block(admin, root.id)).status).toBe(403);
    expect((await block(admin, admin.id)).status).toBe(403);
    expect((await block(root, second.id)).status).toBe(403);
    expect((await block(root, root.id)).status).toBe(403);
    expect((await block(root, otherAdmin.id)).status).toBe(200);
    expect((await block(admin, user.id)).status).toBe(200);
    // Unknown and malformed IDs look the same.
    expect((await block(admin, 'a'.repeat(26))).status).toBe(404);
    expect((await block(admin, 'NOT-AN-ID')).status).toBe(404);
  });
});

describe('admin panel: blocking', () => {
  it('ends every session at once, keeps the data and can be undone', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    await withContent(user);

    const blocked = await admin.api<AdminUser>('POST', `/api/admin/users/${user.id}/block`);
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({ status: 'blocked', blockedAt: expect.any(Number) });
    expect((await user.api('GET', '/api/me')).status).toBe(401);
    // A new session (as after signing in again) is refused too.
    const again = apiAs(call, await sessionCookie(user.id));
    expect(await again('GET', '/api/me')).toMatchObject({
      status: 403,
      body: { error: 'blocked' },
    });
    // Blocking twice changes nothing and is not audited twice.
    expect((await admin.api('POST', `/api/admin/users/${user.id}/block`)).status).toBe(200);

    const unblocked = await admin.api<AdminUser>('POST', `/api/admin/users/${user.id}/unblock`);
    expect(unblocked.body).toMatchObject({ status: 'active', blockedAt: null });
    const fresh = apiAs(call, await sessionCookie(user.id));
    const tree = await fresh<{ boards: unknown[] }>('GET', '/api/boards');
    expect(tree.body.boards).toHaveLength(1);
    expect(await auditOf(user.id)).toEqual([
      ['user.block', admin.id, {}],
      ['user.unblock', admin.id, {}],
    ]);
  });
});

describe('admin panel: extra set and roles', () => {
  it('only someone with the extra set passes it on; superadmins always, also to themselves', async () => {
    const plainAdmin = await as({ role: 'admin' });
    const extraAdmin = await as({ role: 'admin', extraSet: true });
    const root = await as({ role: 'superadmin', email: 'root@example.com' });
    const user = await as();
    const grant = (who: typeof root, target: string, enabled: boolean) =>
      who.api<AdminUser>('POST', `/api/admin/users/${target}/extra-set`, { enabled });

    expect((await grant(plainAdmin, user.id, true)).status).toBe(403);
    expect((await grant(extraAdmin, user.id, true)).body.extraSet).toBe(true);
    expect((await user.api('GET', '/sym/extra/manifest.json')).status).toBe(200);
    expect((await grant(extraAdmin, user.id, false)).body.extraSet).toBe(false);
    expect((await user.api('GET', '/sym/extra/manifest.json')).status).toBe(403);
    expect((await grant(root, root.id, true)).body.extraSet).toBe(true);
    expect((await grant(extraAdmin, extraAdmin.id, false)).status).toBe(403);
    expect((await user.api('POST', `/api/admin/users/${user.id}/extra-set`, {})).status).toBe(403);
    expect((await grant(root, user.id, 'yes' as unknown as boolean)).status).toBe(400);
    expect(await auditOf(user.id)).toEqual([
      ['user.extra_set', extraAdmin.id, { enabled: true }],
      ['user.extra_set', extraAdmin.id, { enabled: false }],
    ]);
  });

  it('superadmins grant and revoke the admin role; it takes effect on the next request', async () => {
    const root = await as({ role: 'superadmin', email: 'root@example.com' });
    const admin = await as({ role: 'admin' });
    const user = await as();
    const setRole = (who: typeof root, target: string, role: string) =>
      who.api<AdminUser>('POST', `/api/admin/users/${target}/role`, { role });

    expect((await setRole(admin, user.id, 'admin')).status).toBe(403);
    expect((await user.api('GET', '/api/admin/users')).status).toBe(403);
    expect((await setRole(root, user.id, 'admin')).body.role).toBe('admin');
    expect((await user.api('GET', '/api/admin/users')).status).toBe(200);
    expect((await user.api<Me>('GET', '/api/me')).body.role).toBe('admin');
    expect((await setRole(root, user.id, 'user')).body.role).toBe('user');
    expect((await user.api('GET', '/api/admin/users')).status).toBe(403);
    // Superadmin comes from ADMIN_EMAILS only.
    expect((await setRole(root, user.id, 'superadmin')).status).toBe(400);
    expect((await setRole(root, root.id, 'user')).status).toBe(403);
    expect(await auditOf(user.id)).toEqual([
      ['user.role', root.id, { role: 'admin' }],
      ['user.role', root.id, { role: 'user' }],
    ]);
  });
});

describe('admin panel: hard delete (PLAN §4.3)', () => {
  it('needs the e-mail typed in, then removes the row, the sessions and the whole vault', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    await withContent(user);
    const path = `/api/admin/users/${user.id}`;

    const wrong = await admin.api('DELETE', path, { email: 'someone@example.com' });
    expect(wrong).toMatchObject({ status: 422, body: { error: 'confirmation_mismatch' } });
    expect((await admin.api('DELETE', path)).status).toBe(400);
    expect((await user.api('GET', '/api/me')).status).toBe(200);

    expect(
      (await admin.api('DELETE', path, { email: ` ${user.email.toUpperCase()} ` })).status,
    ).toBe(204);
    expect((await user.api('GET', '/api/me')).status).toBe(401);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?1')
      .bind(user.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1')
      .bind(user.id)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);
    const tables = await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) =>
      state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((r) => r.name)
        .filter((name) => !name.startsWith('_cf_')),
    );
    expect(tables).toEqual([]);
    // The audit keeps the ID only; the list shows the account as gone.
    expect(await auditOf(user.id)).toEqual([['user.delete', admin.id, {}]]);
    const audit = await admin.api<AuditPage>('GET', `/api/admin/audit?target=${user.id}`);
    expect(audit.body.entries[0]).toMatchObject({
      action: 'user.delete',
      target: { id: user.id, email: null },
    });
    // Repeating finds nothing left to delete.
    expect((await admin.api('DELETE', path, { email: user.email })).status).toBe(404);
  });

  it('finishes an interrupted deletion when retried', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    await withContent(user);
    await env.DB.prepare("UPDATE users SET status = 'deleting' WHERE id = ?1").bind(user.id).run();
    expect((await user.api('GET', '/api/me')).status).toBe(403);
    expect((await admin.api('GET', `/api/admin/users/${user.id}/data`)).status).toBe(404);
    expect((await admin.api('POST', `/api/admin/users/${user.id}/block`)).status).toBe(409);
    expect(
      (await admin.api('DELETE', `/api/admin/users/${user.id}`, { email: user.email })).status,
    ).toBe(204);
    expect(
      (await admin.api<AdminUserList>('GET', '/api/admin/users')).body.users,
    ).not.toContainEqual(expect.objectContaining({ id: user.id }));
  });
});

describe('admin panel: read-only data view', () => {
  it('shows boards, photos and settings, and records every opening', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    const { mediaId } = await withContent(user);

    const data = await admin.api<AdminUserData>('GET', `/api/admin/users/${user.id}/data`);
    expect(data.status).toBe(200);
    expect(data.body.tree.boards[0]!.tiles.map((t) => t.label)).toEqual(['pić']);
    expect(data.body.media.items.map((m) => m.label)).toEqual(['Dom']);
    expect(data.body.settings.activeSets).toEqual(['arasaac', 'own']);
    expect(data.body.user).toMatchObject({ id: user.id, boards: 1, tiles: 1, media: 1 });
    await admin.api('GET', `/api/admin/users/${user.id}/data`);
    expect(await auditOf(user.id)).toEqual([
      ['user.view', admin.id, {}],
      ['user.view', admin.id, {}],
    ]);

    const photo = await call(`/api/admin/users/${user.id}/media/${mediaId}`, {
      headers: { Cookie: admin.cookie },
    });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/webp');
    expect(photo.headers.get('Cache-Control')).toBe('no-store');
    expect(photo.headers.get('Content-Security-Policy')).toContain('sandbox');
    const missing = await call(`/api/admin/users/${user.id}/media/${'b'.repeat(26)}`, {
      headers: { Cookie: admin.cookie },
    });
    expect(missing.status).toBe(404);
    // Data of another admin stays closed to admins.
    const otherAdmin = await as({ role: 'admin' });
    expect((await admin.api('GET', `/api/admin/users/${otherAdmin.id}/data`)).status).toBe(403);
    expect((await admin.api('GET', `/api/admin/users/${admin.id}/data`)).status).toBe(403);
  });
});

describe('admin panel: audit log', () => {
  it('pages newest first and filters by account', async () => {
    const admin = await as({ role: 'admin' });
    const user = await as();
    for (let i = 0; i < 30; i++) {
      await admin.api('POST', `/api/admin/users/${user.id}/${i % 2 ? 'unblock' : 'block'}`);
    }
    const first = await admin.api<AuditPage>('GET', `/api/admin/audit?target=${user.id}`);
    expect(first.body.entries).toHaveLength(30);
    expect(first.body.next).toBeNull();
    expect(first.body.entries[0]).toMatchObject({
      action: 'user.unblock',
      actor: { id: admin.id, email: admin.email },
      target: { id: user.id, email: user.email },
    });

    for (let i = 0; i < 30; i++) {
      await admin.api('POST', `/api/admin/users/${user.id}/${i % 2 ? 'unblock' : 'block'}`);
    }
    const page1 = await admin.api<AuditPage>('GET', `/api/admin/audit?target=${user.id}`);
    expect(page1.body.entries).toHaveLength(50);
    expect(page1.body.next).toEqual(expect.any(Number));
    const page2 = await admin.api<AuditPage>(
      'GET',
      `/api/admin/audit?target=${user.id}&before=${page1.body.next}`,
    );
    expect(page2.body.entries).toHaveLength(10);
    expect(page2.body.next).toBeNull();
    const ids = new Set([...page1.body.entries, ...page2.body.entries].map((e) => e.id));
    expect(ids.size).toBe(60);

    const all = await admin.api<AuditPage>('GET', '/api/admin/audit');
    expect(all.status).toBe(200);
    for (const bad of ['before=0', 'before=-1', 'before=abc', 'target=nope']) {
      expect((await admin.api('GET', `/api/admin/audit?${bad}`)).status, bad).toBe(400);
    }
  });
});
