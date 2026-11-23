import {
  ConfigureBackupSchema,
  ObjectIdSchema,
  type BackupConfigured,
  type BackupIndex,
  type BackupMediaList,
  type BackupStatus,
} from '@aplikaacja/shared';
import type { Context } from 'hono';
import { catalogFor } from '../catalog/catalog.ts';
import type { AppContext } from '../context.ts';
import { auditStatement } from '../lib/audit.ts';
import { validRecipient } from '../lib/backup.ts';
import { newToken, sha256Hex } from '../lib/crypto.ts';
import { defer } from '../lib/defer.ts';
import { vaultFor } from '../vault/user-vault.ts';

/**
 * Encrypted backups (F7, PLAN §6). Superadmin routes set the age recipient and issue the
 * token (shown once, stored as SHA-256); backup routes take that token instead of a
 * session and answer with age files encrypted in the Durable Objects, except for the
 * index and the photo lists (opaque IDs). A vault is only woken for an account in D1, so a
 * deleted account's vault is never recreated.
 */
type Ctx = Context<AppContext>;

interface ConfigRow {
  recipient: string;
  created_at: number;
  created_by: string;
  last_used_at: number | null;
}

const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);

function toStatus(row: ConfigRow | null): BackupStatus {
  return {
    configured: row !== null,
    recipient: row?.recipient ?? null,
    createdAt: row?.created_at ?? null,
    createdBy: row?.created_by ?? null,
    lastUsedAt: row?.last_used_at ?? null,
  };
}

async function readConfig(db: D1Database): Promise<ConfigRow | null> {
  return db
    .prepare(
      'SELECT recipient, created_at, created_by, last_used_at FROM backup_config WHERE id = 1',
    )
    .first<ConfigRow>();
}

/** Short form of a recipient for the audit log (a post-quantum one is ~2000 characters). */
const recipientTag = (recipient: string) => `${recipient.slice(0, 16)}…${recipient.slice(-6)}`;

const sealed = (c: Ctx, data: Uint8Array | null) =>
  data
    ? c.body(data as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'application/octet-stream' })
    : notFound(c);

// --- superadmin -------------------------------------------------------------------------

export async function status(c: Ctx): Promise<Response> {
  return c.json<BackupStatus>(toStatus(await readConfig(c.env.DB)));
}

/** A new recipient always comes with a new token: the old one stops working at once. */
export function configure(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const parsed = ConfigureBackupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !validRecipient(parsed.data.recipient)) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    const { recipient } = parsed.data;
    const token = newToken();
    const at = now();
    const actor = c.get('user').userId;
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO backup_config (id, recipient, token_hash, created_at, created_by)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET recipient = excluded.recipient,
           token_hash = excluded.token_hash, created_at = excluded.created_at,
           created_by = excluded.created_by, last_used_at = NULL`,
      ).bind(recipient, await sha256Hex(token), at, actor),
      auditStatement(c.env.DB, {
        at,
        actor,
        action: 'backup.configure',
        details: { recipient: recipientTag(recipient) },
      }),
    ]);
    return c.json<BackupConfigured>({
      status: toStatus({ recipient, created_at: at, created_by: actor, last_used_at: null }),
      token,
    });
  };
}

export function disable(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const [deleted] = await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM backup_config WHERE id = 1'),
    ]);
    if (deleted?.meta.changes) {
      await auditStatement(c.env.DB, {
        at: now(),
        actor: c.get('user').userId,
        action: 'backup.disable',
      }).run();
    }
    return c.body(null, 204);
  };
}

// --- the backup job -----------------------------------------------------------------------

/** Start of a run: what to fetch. Recorded in the audit log under the superadmin who set it up. */
export function index(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const at = now();
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM users WHERE status != 'deleting' ORDER BY id`,
    ).all<{ id: string }>();
    const catalog = await catalogFor(c.env).backupIndex();
    defer(c)(
      c.env.DB.batch([
        c.env.DB.prepare('UPDATE backup_config SET last_used_at = ?1 WHERE id = 1').bind(at),
        auditStatement(c.env.DB, {
          at,
          actor: c.get('backup').createdBy,
          action: 'backup.run',
          details: { accounts: results.length, catalog: catalog.length },
        }),
      ]),
    );
    return c.json<BackupIndex>({ v: 1, at, users: results.map((r) => r.id), catalog });
  };
}

export async function accounts(c: Ctx): Promise<Response> {
  return sealed(c, await catalogFor(c.env).backupAccounts(c.get('backup').recipient));
}

export async function catalogDump(c: Ctx): Promise<Response> {
  return sealed(c, await catalogFor(c.env).backupDump(c.get('backup').recipient));
}

export async function catalogPhoto(c: Ctx): Promise<Response> {
  const id = c.req.param('id');
  const key = c.req.param('key');
  if (!ObjectIdSchema.safeParse(id).success || !ObjectIdSchema.safeParse(key).success) {
    return notFound(c);
  }
  return sealed(
    c,
    await catalogFor(c.env).backupPhoto(c.get('backup').recipient, id as string, key as string),
  );
}

/**
 * The account named in the path, if D1 has it and it is not being deleted: never wake (and
 * so recreate) a vault that is gone or going.
 */
async function account(c: Ctx): Promise<string | null> {
  const id = c.req.param('id');
  if (!id || !ObjectIdSchema.safeParse(id).success) return null;
  const row = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?1 AND status != 'deleting'`)
    .bind(id)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function user(c: Ctx): Promise<Response> {
  const id = await account(c);
  if (!id) return notFound(c);
  return sealed(c, await vaultFor(c.env, id).backupDump(c.get('backup').recipient));
}

export async function userMediaList(c: Ctx): Promise<Response> {
  const id = await account(c);
  if (!id) return notFound(c);
  return c.json<BackupMediaList>({ media: await vaultFor(c.env, id).backupMediaIds() });
}

export async function userMedia(c: Ctx): Promise<Response> {
  const id = await account(c);
  const mediaId = c.req.param('mediaId');
  if (!id || !mediaId || !ObjectIdSchema.safeParse(mediaId).success) return notFound(c);
  return sealed(c, await vaultFor(c.env, id).backupMedia(c.get('backup').recipient, mediaId));
}
