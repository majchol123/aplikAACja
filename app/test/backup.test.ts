import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { BackupConfigured, BackupIndex, BackupStatus, BoardChanges } from '@relaacja/shared';
import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { describe, expect, it } from 'vitest';
import { catalogFor, type Catalog } from '../src/worker/catalog/catalog.ts';
import { D1_BACKUP_TABLES, D1_NOT_BACKED_UP, type TableDump } from '../src/worker/lib/backup.ts';
import { newId } from '../src/worker/lib/crypto.ts';
import { apiAs, insertUser, makeApp, sessionCookie, uploadAs } from './helpers.ts';
import { webp } from './images.ts';

const { call } = makeApp();

async function superadmin() {
  // Superadmin comes from ADMIN_EMAILS (vitest.config.ts).
  const user = await insertUser({ role: 'superadmin', email: 'root@example.com' });
  const cookie = await sessionCookie(user.id);
  return { ...user, cookie, api: apiAs(call, cookie) };
}

async function keys() {
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

async function configure(api: Awaited<ReturnType<typeof superadmin>>['api'], recipient: string) {
  const res = await api<BackupConfigured>('PUT', '/api/admin/backup', { recipient });
  expect(res.status).toBe(200);
  return res.body.token;
}

const job = (token: string) => (path: string) =>
  call(path, { headers: { Authorization: `Bearer ${token}` } });

async function open<T>(res: Response, identity: string): Promise<T> {
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(new TextDecoder().decode(bytes.slice(0, 21))).toBe('age-encryption.org/v1');
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(bytes, 'text')) as T;
}

async function openBytes(res: Response, identity: string): Promise<Uint8Array> {
  expect(res.status).toBe(200);
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return decrypter.decrypt(new Uint8Array(await res.arrayBuffer()));
}

type Dump = { v: 1; kind: string; tables: Record<string, TableDump> };
const rowsOf = (table: TableDump) =>
  table.rows.map((row) => Object.fromEntries(table.columns.map((c, i) => [c, row[i]])));

describe('encrypted backups (F7, PLAN §6)', () => {
  it('a superadmin sets the recipient and gets a token once; the status never shows it', async () => {
    const root = await superadmin();
    expect((await root.api<BackupStatus>('GET', '/api/admin/backup')).body.configured).toBe(false);
    const { recipient } = await keys();
    const token = await configure(root.api, recipient);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const status = await root.api<BackupStatus>('GET', '/api/admin/backup');
    expect(status.body).toMatchObject({ configured: true, recipient, createdBy: root.id });
    expect(JSON.stringify(status.body)).not.toContain(token);
    const { results } = await env.DB.prepare(
      "SELECT details FROM admin_audit WHERE actor_user_id = ?1 AND action = 'backup.configure'",
    )
      .bind(root.id)
      .all<{ details: string }>();
    expect(JSON.parse(results.at(-1)!.details).recipient).toBe(
      `${recipient.slice(0, 16)}…${recipient.slice(-6)}`,
    );
  });

  it('refuses what is not an age recipient, a bad checksum included', async () => {
    const root = await superadmin();
    const { recipient } = await keys();
    const broken = recipient.slice(0, -1) + (recipient.endsWith('q') ? 'p' : 'q');
    for (const bad of [broken, 'age1', 'ssh-ed25519 AAAA', recipient + 'x', '']) {
      expect((await root.api('PUT', '/api/admin/backup', { recipient: bad })).status).toBe(400);
    }
  });

  it('the job reads every account, the catalogue and D1, all encrypted for the key', async () => {
    const root = await superadmin();
    const { identity, recipient } = await keys();
    const token = await configure(root.api, recipient);
    const get = job(token);

    const owner = await insertUser();
    const ownerCookie = await sessionCookie(owner.id);
    const home = await apiAs(call, ownerCookie)<BoardChanges>('POST', '/api/boards/home', {
      name: 'Start',
      rows: 2,
      cols: 2,
    });
    expect(home.status).toBe(201);
    const photo = await uploadAs(call, ownerCookie)<{ media: { id: string } }>(
      'Mama',
      webp(10, 10),
    );

    const index = (await (await get('/api/backup/index')).json()) as BackupIndex;
    expect(index.v).toBe(1);
    expect(index.users).toContain(owner.id);

    const vault = await open<Dump>(await get(`/api/backup/users/${owner.id}`), identity);
    expect(vault.kind).toBe('vault');
    expect(rowsOf(vault.tables.boards!).map((b) => b.name)).toEqual(['Start']);
    expect(rowsOf(vault.tables.media!).map((m) => m.label)).toEqual(['Mama']);
    expect(vault.tables._schema).toBeDefined();
    // Photo bytes travel one by one, and never inside the dump.
    expect(vault.tables.media_data).toBeUndefined();
    expect(vault.tables.inbox_media?.columns).not.toContain('data');

    const list = (await (await get(`/api/backup/users/${owner.id}/media`)).json()) as {
      media: string[];
    };
    expect(list.media).toEqual([photo.body.media.id]);
    const bytes = await openBytes(
      await get(`/api/backup/users/${owner.id}/media/${photo.body.media.id}`),
      identity,
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await get(`/api/backup/users/${owner.id}/media/${newId()}`)).status).toBe(404);

    const d1 = await open<Dump>(await get('/api/backup/d1'), identity);
    expect(Object.keys(d1.tables).sort()).toEqual([...D1_BACKUP_TABLES].sort());
    expect(rowsOf(d1.tables.users!).map((u) => u.id)).toContain(owner.id);

    const audit = await env.DB.prepare(
      "SELECT details FROM admin_audit WHERE actor_user_id = ?1 AND action = 'backup.run'",
    )
      .bind(root.id)
      .first<{ details: string }>();
    expect(JSON.parse(audit!.details).accounts).toBe(index.users.length);
    const status = await root.api<BackupStatus>('GET', '/api/admin/backup');
    expect(status.body.lastUsedAt).toBe(index.at);
  });

  it('catalogue entries and their photos are in the backup', async () => {
    const root = await superadmin();
    const { identity, recipient } = await keys();
    const get = job(await configure(root.api, recipient));
    const entry = newId();
    const key = 'c'.repeat(26);
    await runInDurableObject(catalogFor(env), (_i: Catalog, state) => {
      state.storage.sql.exec(
        `INSERT INTO entries (id, name, description, package, boards, tiles, photos, bytes,
           published_by, created_at, updated_at)
         VALUES (?, 'Poranek', '', '{}', 1, 0, 1, 3, 'x', 0, 0)`,
        entry,
      );
      state.storage.sql.exec(
        `INSERT INTO entry_media (entry_id, key, label, mime, width, height, bytes, sha256, data)
         VALUES (?, ?, 'Mama', 'image/webp', 1, 1, 3, 'x', ?)`,
        entry,
        key,
        new Uint8Array([1, 2, 3]),
      );
    });
    const index = (await (await get('/api/backup/index')).json()) as BackupIndex;
    expect(index.catalog).toContainEqual({ id: entry, photos: [key] });
    const dump = await open<Dump>(await get('/api/backup/catalog'), identity);
    expect(rowsOf(dump.tables.entries!).find((e) => e.id === entry)?.name).toBe('Poranek');
    expect(dump.tables.entry_media?.columns).not.toContain('data');
    const photo = await openBytes(
      await get(`/api/backup/catalog/${entry}/photos/${key}`),
      identity,
    );
    expect([...photo]).toEqual([1, 2, 3]);
  });

  it('a new recipient revokes the old token; turning backups off revokes the last one', async () => {
    const root = await superadmin();
    const first = await configure(root.api, (await keys()).recipient);
    const second = await configure(root.api, (await keys()).recipient);
    expect((await job(first)('/api/backup/index')).status).toBe(401);
    expect((await job(second)('/api/backup/index')).status).toBe(200);
    expect((await root.api('DELETE', '/api/admin/backup')).status).toBe(204);
    expect((await job(second)('/api/backup/index')).status).toBe(401);
    expect((await root.api<BackupStatus>('GET', '/api/admin/backup')).body.configured).toBe(false);
    expect((await root.api('DELETE', '/api/admin/backup')).status).toBe(204);
  });

  it('accounts missing from D1 or being deleted are not found (their vaults stay asleep)', async () => {
    const root = await superadmin();
    const get = job(await configure(root.api, (await keys()).recipient));
    const going = await insertUser({ status: 'deleting' });
    const index = (await (await get('/api/backup/index')).json()) as BackupIndex;
    expect(index.users).not.toContain(going.id);
    for (const path of [
      `/api/backup/users/${going.id}`,
      `/api/backup/users/${newId()}`,
      `/api/backup/users/${newId()}/media`,
      '/api/backup/users/not-an-id',
    ]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it('only a well-formed bearer token counts; a session cookie does not', async () => {
    const root = await superadmin();
    await configure(root.api, (await keys()).recipient);
    for (const headers of <Record<string, string>[]>[
      { Cookie: root.cookie },
      { Authorization: 'Bearer short' },
      { Authorization: `Basic ${'a'.repeat(43)}` },
      { Authorization: `Bearer ${'a'.repeat(43)}` },
    ]) {
      expect((await call('/api/backup/index', { headers })).status).toBe(401);
    }
  });

  it('every D1 table is either backed up or left out on purpose', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual(
      [...D1_BACKUP_TABLES, ...D1_NOT_BACKED_UP].sort(),
    );
  });
});
