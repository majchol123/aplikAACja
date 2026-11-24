import { Encrypter } from 'age-encryption';
import { base64urlEncode } from './encoding.ts';

/**
 * Encryption of backup files (PLAN §6, F7). Runs in the Durable Objects (30 s of CPU per
 * request, not the Worker's 10 ms): every file is an age file for the recipient set by a
 * superadmin, so whoever holds the backup token gets ciphertext only.
 */
export async function sealFor(recipient: string, data: Uint8Array | string): Promise<Uint8Array> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(data);
}

/** Checksum and key length too, not just the shape the schema checks. */
export function validRecipient(recipient: string): boolean {
  try {
    new Encrypter().addRecipient(recipient);
    return true;
  } catch {
    return false;
  }
}

/**
 * D1 tables in a backup; the rest is left out on purpose (a test checks every table is in
 * one of the two lists): live sessions are worthless after a restore, the backup token's
 * own hash has no place next to the data it unlocks, and usage counters (statistics v2)
 * are not the account's data to restore — fewer copies of them is the better default.
 */
export const D1_BACKUP_TABLES = ['users', 'admin_audit', 'category_icons'] as const;
export const D1_NOT_BACKED_UP = [
  'sessions',
  'backup_config',
  'd1_migrations',
  'usage_daily',
] as const;

export interface TableDump {
  columns: string[];
  rows: unknown[][];
}

/**
 * Every table of a Durable Object's SQLite as columns and rows, for a backup that can be
 * restored exactly (its schema version is a table too). Big pictures are left to their own
 * requests (`skip`: a whole table, or some of its columns); other BLOBs become
 * `{"$base64url": …}`.
 */
export function dumpTables(
  sql: SqlStorage,
  skip: Readonly<Record<string, true | readonly string[]>>,
): Record<string, TableDump> {
  // SQLite's own tables and Cloudflare's (_cf_*) are not data of the app.
  const tables = sql
    .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .toArray()
    .filter(({ name }) => !name.startsWith('sqlite_') && !name.startsWith('_cf_'));
  const out: Record<string, TableDump> = {};
  for (const { name } of tables) {
    const rule = skip[name];
    if (rule === true) continue;
    const columns = sql
      .exec<{ name: string }>('SELECT name FROM pragma_table_info(?)', name)
      .toArray()
      .map((c) => c.name)
      .filter((c) => !rule?.includes(c));
    const list = columns.map((c) => `"${c.replaceAll('"', '""')}"`).join(', ');
    const cursor = sql.exec(`SELECT ${list} FROM "${name.replaceAll('"', '""')}"`);
    const rows = Array.from(cursor.raw(), (row) =>
      row.map((v) =>
        v instanceof ArrayBuffer ? { $base64url: base64urlEncode(new Uint8Array(v)) } : v,
      ),
    );
    out[name] = { columns, rows };
  }
  return out;
}
