import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { DEFAULT_SETTINGS } from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { BoardStore } from '../src/worker/vault/boards.ts';
import { VAULT_MIGRATIONS, applyMigration, migrateVault } from '../src/worker/vault/schema.ts';
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
        'vault_meta',
      ]) {
        expect(tables).toContain(t);
      }
    });
  });

  it('upgrades a v1 vault: settings kept, board tables rebuilt with the tree constraints', async () => {
    const stub = vaultFor(env, 'vault-v1');
    await runInDurableObject(stub, async (_i: UserVault, state) => {
      // Recreate exactly what F1 code left behind.
      await state.storage.deleteAll();
      const sql = state.storage.sql;
      sql.exec(
        'CREATE TABLE _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
      );
      applyMigration(sql, VAULT_MIGRATIONS[0]!);
      sql.exec('INSERT INTO _schema (id, version) VALUES (1, 1)');
      sql.exec(`INSERT INTO settings (key, value) VALUES ('activeSets', '["extra","arasaac"]')`);

      expect(migrateVault(state.storage)).toBe(VAULT_MIGRATIONS.length);
      const columns = sql
        .exec<{ name: string }>("SELECT name FROM pragma_table_info('tiles')")
        .toArray()
        .map((c) => c.name);
      expect(columns).not.toContain('rev');
      expect(sql.exec('SELECT * FROM vault_meta').one()).toMatchObject({
        version: 0,
        boards: 0,
        tiles: 0,
        preferred: 0,
      });
    });
    expect((await stub.getSettings()).activeSets).toEqual(['extra', 'arasaac']);
  });

  it('upgrades a v8 vault: boards and tiles survive the rebuild for taller grids (v9)', async () => {
    const stub = vaultFor(env, 'vault-v8');
    await runInDurableObject(stub, async (_i: UserVault, state) => {
      await state.storage.deleteAll();
      const sql = state.storage.sql;
      sql.exec(
        'CREATE TABLE _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
      );
      for (const migration of VAULT_MIGRATIONS.slice(0, 8)) applyMigration(sql, migration);
      sql.exec('INSERT INTO _schema (id, version) VALUES (1, 8)');
      const [home, food] = ['h'.repeat(26), 'f'.repeat(26)];
      sql.exec(
        `INSERT INTO boards (id, name, parent_board_id, rows, cols, rev, created_at, updated_at)
         VALUES (?1, 'Pulpit', NULL, 4, 6, 7, 1, 2), (?2, 'Jedzenie', ?1, 12, 12, 3, 1, 2)`,
        home,
        food,
      );
      sql.exec(
        `INSERT INTO tiles (id, board_id, row, col, kind, target_board_id, label, color_role,
                            symbol_set, symbol_ref, hidden, speech, created_at, updated_at)
         VALUES ('${'a'.repeat(26)}', ?1, 0, 1, 'folder', ?2, 'Jedzenie', 'noun', NULL, NULL, 0, NULL, 1, 2),
                ('${'b'.repeat(26)}', ?1, 1, 0, 'word', NULL, 'pić', 'verb', 'arasaac', '6061', 1, 'Chcę pić', 1, 2),
                ('${'c'.repeat(26)}', ?2, 11, 11, 'word', NULL, 'jabłko', NULL, NULL, NULL, 0, NULL, 1, 2)`,
        home,
        food,
      );
      const before = sql.exec('SELECT * FROM tiles ORDER BY id').toArray();
      expect(sql.exec('SELECT boards, tiles FROM vault_meta').one()).toEqual({
        boards: 2,
        tiles: 3,
      });

      expect(migrateVault(state.storage)).toBe(VAULT_MIGRATIONS.length);
      expect(sql.exec('SELECT * FROM tiles ORDER BY id').toArray()).toEqual(before);
      expect(sql.exec('SELECT id, rows, cols, rev FROM boards ORDER BY id').toArray()).toEqual([
        { id: food, rows: 12, cols: 12, rev: 3 },
        { id: home, rows: 4, cols: 6, rev: 7 },
      ]);
      expect(new BoardStore(state.storage).integrity()).toEqual([]);
      // Nothing points at the copies' temporary names; indexes and counting triggers are back.
      const schema = sql
        .exec<{ type: string; name: string; sql: string | null }>(
          "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        )
        .toArray();
      expect(schema.filter((o) => o.sql?.includes('_v9'))).toEqual([]);
      const names = schema.map((o) => o.name);
      for (const name of [
        'idx_boards_parent',
        'idx_boards_home',
        'idx_tiles_own',
        'boards_counted',
        'boards_uncounted',
        'tiles_counted',
        'tiles_uncounted',
      ]) {
        expect(names).toContain(name);
      }

      // Up to 40 rows now, still not more; deleting a board still cascades and counts.
      sql.exec('UPDATE boards SET rows = 40 WHERE id = ?', food);
      expect(() => sql.exec('UPDATE boards SET rows = 41 WHERE id = ?', food)).toThrow(/CHECK/);
      expect(() => sql.exec('UPDATE boards SET cols = 13 WHERE id = ?', food)).toThrow(/CHECK/);
      sql.exec('DELETE FROM boards WHERE id = ?', food);
      expect(sql.exec('SELECT COUNT(*) AS n FROM tiles').one().n).toBe(1);
      expect(sql.exec('SELECT boards, tiles FROM vault_meta').one()).toEqual({
        boards: 1,
        tiles: 1,
      });
    });
  });

  it('frees the first cell of the home board for "Wszystkie symbole" (v10)', async () => {
    /** A v9 vault with one home board of `rows` × `cols` and tiles at the given cells. */
    const v9 = async (
      name: string,
      rows: number,
      cols: number,
      cells: [string, number, number][],
    ) => {
      const stub = vaultFor(env, name);
      await runInDurableObject(stub, async (_i: UserVault, state) => {
        await state.storage.deleteAll();
        const sql = state.storage.sql;
        sql.exec(
          'CREATE TABLE _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
        );
        for (const migration of VAULT_MIGRATIONS.slice(0, 9)) applyMigration(sql, migration);
        sql.exec('INSERT INTO _schema (id, version) VALUES (1, 9)');
        sql.exec(
          `INSERT INTO boards (id, name, parent_board_id, rows, cols, rev, created_at, updated_at)
           VALUES (?, 'Pulpit', NULL, ?, ?, 5, 1, 2)`,
          'h'.repeat(26),
          rows,
          cols,
        );
        for (const [label, row, col] of cells) {
          sql.exec(
            `INSERT INTO tiles (id, board_id, row, col, kind, label, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'word', ?, 1, 2)`,
            label.padEnd(26, 'a'),
            'h'.repeat(26),
            row,
            col,
            label,
          );
        }
      });
      return stub;
    };
    const after = (stub: DurableObjectStub<UserVault>) =>
      runInDurableObject(stub, (_i: UserVault, state) => {
        migrateVault(state.storage);
        const sql = state.storage.sql;
        return {
          tiles: sql
            .exec<{ label: string; row: number; col: number }>(
              'SELECT label, row, col FROM tiles ORDER BY label',
            )
            .toArray()
            .map((t) => `${t.label}@${t.row},${t.col}`),
          board: sql.exec('SELECT rows, cols, rev FROM boards').one(),
          version: sql.exec<{ version: number }>('SELECT version FROM vault_meta').one().version,
          problems: new BoardStore(state.storage).integrity(),
        };
      });

    // The tile there takes the first free cell in reading order.
    expect(
      await after(
        await v9('vault-v9-free', 2, 2, [
          ['ja', 0, 0],
          ['ty', 0, 1],
          ['nie', 1, 1],
        ]),
      ),
    ).toEqual({
      tiles: ['ja@1,0', 'nie@1,1', 'ty@0,1'],
      board: { rows: 2, cols: 2, rev: 6 },
      version: 1,
      problems: [],
    });
    // A full board grows by a row for it.
    expect(
      await after(
        await v9('vault-v9-full', 1, 2, [
          ['ja', 0, 0],
          ['ty', 0, 1],
        ]),
      ),
    ).toMatchObject({ tiles: ['ja@1,0', 'ty@0,1'], board: { rows: 2, cols: 2 }, problems: [] });
    // Nothing there: nothing changes.
    expect(await after(await v9('vault-v9-empty', 2, 2, [['ty', 0, 1]]))).toMatchObject({
      tiles: ['ty@0,1'],
      board: { rev: 5 },
      version: 0,
    });
  });

  it('names the home board "Pulpit" (v11)', async () => {
    const v10 = (name: string, home: string) =>
      runInDurableObject(vaultFor(env, name), async (_i: UserVault, state) => {
        await state.storage.deleteAll();
        const sql = state.storage.sql;
        sql.exec(
          'CREATE TABLE _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
        );
        for (const migration of VAULT_MIGRATIONS.slice(0, 10)) applyMigration(sql, migration);
        sql.exec('INSERT INTO _schema (id, version) VALUES (1, 10)');
        sql.exec(
          `INSERT INTO boards (id, name, parent_board_id, rows, cols, rev, created_at, updated_at)
           VALUES (?1, ?2, NULL, 4, 6, 5, 1, 2), (?3, 'Start', ?1, 2, 2, 3, 1, 2)`,
          'h'.repeat(26),
          home,
          'f'.repeat(26),
        );
        sql.exec(
          `INSERT INTO tiles (id, board_id, row, col, kind, target_board_id, label, created_at, updated_at)
           VALUES (?, ?, 0, 1, 'folder', ?, 'Start', 1, 2)`,
          'a'.repeat(26),
          'h'.repeat(26),
          'f'.repeat(26),
        );
        migrateVault(state.storage);
        return {
          boards: sql.exec('SELECT name, rev FROM boards ORDER BY id').toArray(),
          version: sql.exec<{ version: number }>('SELECT version FROM vault_meta').one().version,
          problems: new BoardStore(state.storage).integrity(),
        };
      });
    // Renamed with a new revision; a sub-board of the same name keeps it.
    expect(await v10('vault-v10-start', 'Start')).toEqual({
      boards: [
        { name: 'Start', rev: 3 },
        { name: 'Pulpit', rev: 6 },
      ],
      version: 1,
      problems: [],
    });
    expect(await v10('vault-v10-pulpit', 'Pulpit')).toMatchObject({
      boards: [{}, { name: 'Pulpit', rev: 5 }],
      version: 0,
    });
  });

  it('keeps working on a newer schema after a code rollback', async () => {
    await runInDurableObject(vaultFor(env, 'vault-newer'), (_i: UserVault, state) => {
      state.storage.sql.exec('UPDATE _schema SET version = 99 WHERE id = 1');
      expect(migrateVault(state.storage)).toBe(99);
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
    // Until the first refusal: the bucket refills while the requests run (2 per second), so
    // a slow machine needs a few more than the burst to drain it.
    const statuses: number[] = [];
    for (let i = 0; i < 400 && statuses.at(-1) !== 429; i++) {
      const res = await t.call('/api/settings', {
        method: 'PATCH',
        headers: writeHeaders(cookie),
        body: JSON.stringify({ returnToHome: i % 2 === 0 }),
      });
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.length).toBeGreaterThan(120);
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
