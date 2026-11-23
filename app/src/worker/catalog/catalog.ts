import { DurableObject } from 'cloudflare:workers';
import {
  CATALOG_LIMITS,
  type BackupIndex,
  type CatalogEntry,
  type PatchCatalog,
  type ShareCounts,
  type SharePhoto,
} from '@relaacja/shared';
import type { AppEnv } from '../env.ts';
import { D1_BACKUP_TABLES, dumpTables, sealFor, type TableDump } from '../lib/backup.ts';
import { newId } from '../lib/crypto.ts';
import type { PackagePhoto } from '../vault/media.ts';

/** Forward-only schema of the catalogue (same rules as the vault's, vault/schema.ts). */
const CATALOG_MIGRATIONS: readonly string[] = [
  // v1 — published packages with their photos; who published one is kept by ID only.
  `CREATE TABLE entries (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     description TEXT NOT NULL,
     package TEXT NOT NULL,
     boards INTEGER NOT NULL,
     tiles INTEGER NOT NULL,
     photos INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     published_by TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE entry_media (
     entry_id TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
     key TEXT NOT NULL,
     label TEXT NOT NULL,
     mime TEXT NOT NULL CHECK (mime IN ('image/webp', 'image/jpeg', 'image/png')),
     width INTEGER NOT NULL,
     height INTEGER NOT NULL,
     bytes INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     data BLOB NOT NULL,
     PRIMARY KEY (entry_id, key)
   );`,
];

function migrate(storage: DurableObjectStorage): void {
  const sql = storage.sql;
  sql.exec(
    'CREATE TABLE IF NOT EXISTS _schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)',
  );
  const current =
    sql.exec<{ version: number }>('SELECT version FROM _schema WHERE id = 1').toArray()[0]
      ?.version ?? 0;
  if (current >= CATALOG_MIGRATIONS.length) return;
  storage.transactionSync(() => {
    for (const migration of CATALOG_MIGRATIONS.slice(current)) sql.exec(migration);
    sql.exec(
      'INSERT INTO _schema (id, version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET version = excluded.version',
      CATALOG_MIGRATIONS.length,
    );
  });
}

type EntryRow = {
  id: string;
  name: string;
  description: string;
  boards: number;
  tiles: number;
  photos: number;
  bytes: number;
  created_at: number;
  updated_at: number;
};

const COLUMNS = 'id, name, description, boards, tiles, photos, bytes, created_at, updated_at';

const toEntry = (r: EntryRow): CatalogEntry => ({
  id: r.id,
  name: r.name,
  description: r.description,
  boards: r.boards,
  tiles: r.tiles,
  photos: r.photos,
  bytes: r.bytes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** What an admin publishes: a package built by their vault (vault/user-vault.ts). */
export interface Publication extends ShareCounts {
  name: string;
  description: string;
  /** BoardPackage as JSON. */
  package: string;
  files: PackagePhoto[];
  publishedBy: string;
}

/**
 * The one catalogue of public boards (PLAN §2.8), a Durable Object of its own in the EU
 * jurisdiction. Reads are for every signed-in account, changes for admins (the Worker
 * checks roles and writes the audit).
 */
export class Catalog extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage));
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  list(): CatalogEntry[] {
    return this.sql
      .exec<EntryRow>(`SELECT ${COLUMNS} FROM entries ORDER BY name COLLATE NOCASE, id`)
      .toArray()
      .map(toEntry);
  }

  entry(id: string): { entry: CatalogEntry; package: string; photos: SharePhoto[] } | null {
    const row = this.sql
      .exec<EntryRow & { package: string }>(
        `SELECT ${COLUMNS}, package FROM entries WHERE id = ?`,
        id,
      )
      .toArray()[0];
    if (!row) return null;
    const photos = this.sql
      .exec<SharePhoto>(
        'SELECT key, label, mime, width, height, bytes FROM entry_media WHERE entry_id = ? ORDER BY key',
        id,
      )
      .toArray();
    return { entry: toEntry(row), package: row.package, photos };
  }

  photo(id: string, key: string): { mime: PackagePhoto['mime']; data: ArrayBuffer } | null {
    return (
      this.sql
        .exec<{ mime: PackagePhoto['mime']; data: ArrayBuffer }>(
          'SELECT mime, data FROM entry_media WHERE entry_id = ? AND key = ?',
          id,
          key,
        )
        .toArray()[0] ?? null
    );
  }

  /** The package with its photos, for copying into an account. */
  copy(id: string): { package: string; files: PackagePhoto[] } | null {
    const row = this.sql
      .exec<{ package: string }>('SELECT package FROM entries WHERE id = ?', id)
      .toArray()[0];
    if (!row) return null;
    const files = this.sql
      .exec<PackagePhoto>(
        'SELECT key, label, mime, width, height, bytes, sha256, data FROM entry_media WHERE entry_id = ?',
        id,
      )
      .toArray();
    return { package: row.package, files };
  }

  // --- backups (F7, PLAN §6): this one object also holds the copy of D1 --------------

  backupIndex(): BackupIndex['catalog'] {
    const photos = this.sql
      .exec<{ entry_id: string; key: string }>(
        'SELECT entry_id, key FROM entry_media ORDER BY entry_id, key',
      )
      .toArray();
    return this.sql
      .exec<{ id: string }>('SELECT id FROM entries ORDER BY id')
      .toArray()
      .map(({ id }) => ({ id, photos: photos.filter((p) => p.entry_id === id).map((p) => p.key) }));
  }

  async backupDump(recipient: string): Promise<Uint8Array> {
    const tables = dumpTables(this.sql, { entry_media: ['data'] });
    return sealFor(recipient, JSON.stringify({ v: 1, kind: 'catalog', at: Date.now(), tables }));
  }

  async backupPhoto(recipient: string, id: string, key: string): Promise<Uint8Array | null> {
    const photo = this.photo(id, key);
    return photo ? sealFor(recipient, new Uint8Array(photo.data)) : null;
  }

  /** Accounts, audit log and folder pictures from D1, encrypted here for the CPU time. */
  async backupAccounts(recipient: string): Promise<Uint8Array> {
    const tables: Record<string, TableDump> = {};
    for (const name of D1_BACKUP_TABLES) {
      const [columns, ...rows] = await this.env.DB.prepare(`SELECT * FROM ${name}`).raw<unknown[]>({
        columnNames: true,
      });
      tables[name] = { columns, rows };
    }
    return sealFor(recipient, JSON.stringify({ v: 1, kind: 'd1', at: Date.now(), tables }));
  }

  publish(input: Publication): CatalogEntry | { error: 'catalog_full' } {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM entries').one().n;
      if (count >= CATALOG_LIMITS.maxEntries) return { error: 'catalog_full' } as const;
      const row: EntryRow = {
        id: newId(),
        name: input.name,
        description: input.description,
        boards: input.boards,
        tiles: input.tiles,
        photos: input.photos,
        bytes: input.bytes,
        created_at: now,
        updated_at: now,
      };
      this.sql.exec(
        `INSERT INTO entries (id, name, description, package, boards, tiles, photos, bytes,
                              published_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.name,
        row.description,
        input.package,
        row.boards,
        row.tiles,
        row.photos,
        row.bytes,
        input.publishedBy,
        now,
        now,
      );
      for (const p of input.files) {
        this.sql.exec(
          `INSERT INTO entry_media (entry_id, key, label, mime, width, height, bytes, sha256, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          p.key,
          p.label,
          p.mime,
          p.width,
          p.height,
          p.bytes,
          p.sha256,
          p.data,
        );
      }
      return toEntry(row);
    });
  }

  update(id: string, patch: PatchCatalog): CatalogEntry | null {
    const row = this.sql
      .exec<EntryRow>(
        `UPDATE entries SET name = coalesce(?1, name), description = coalesce(?2, description),
                            package = CASE WHEN ?1 IS NULL THEN package
                                           ELSE json_set(package, '$.name', ?1) END,
                            updated_at = ?3
          WHERE id = ?4 RETURNING ${COLUMNS}`,
        patch.name ?? null,
        patch.description ?? null,
        Date.now(),
        id,
      )
      .toArray()[0];
    return row ? toEntry(row) : null;
  }

  withdraw(id: string): { name: string } | null {
    return (
      this.sql
        .exec<{ name: string }>('DELETE FROM entries WHERE id = ? RETURNING name', id)
        .toArray()[0] ?? null
    );
  }
}

/** The single catalogue object, in the EU jurisdiction where deployed (like the vaults). */
export function catalogFor(env: AppEnv): DurableObjectStub<Catalog> {
  const ns = env.DO_JURISDICTION === 'eu' ? env.CATALOG.jurisdiction('eu') : env.CATALOG;
  return ns.getByName('catalog');
}
