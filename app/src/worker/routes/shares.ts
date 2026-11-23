import {
  AcceptShareSchema,
  BoardPackageSchema,
  ObjectIdSchema,
  SendShareSchema,
  type ReceivedShare,
  type ReceivedShareView,
  type ShareLists,
} from '@aplikaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { defer } from '../lib/defer.ts';
import type { InboxEntry } from '../vault/shares.ts';
import { vaultFor, type ShareSender } from '../vault/user-vault.ts';
import { recordTotals } from './totals.ts';

/**
 * Sending a copy of a board to another account (PLAN §2.8). Besides the admin panel, the
 * only place where a request reaches another account's vault, and only to drop a share
 * into its inbox (delivery) or to tell a sender the decision — never to read anything.
 */
type Ctx = Context<AppContext>;

const invalid = (c: Ctx) => c.json({ error: 'invalid_request' }, 400);
const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);
const rateLimited = (c: Ctx) => c.json({ error: 'rate_limited' }, 429);

/** The caller's own vault: always derived from the session, never from the request. */
function vault(c: Ctx) {
  return vaultFor(c.env, c.get('user').userId);
}

function pathId(c: Ctx, name = 'id'): string | null {
  const id = c.req.param(name);
  return id && ObjectIdSchema.safeParse(id).success ? id : null;
}

/** An active account with this address (the most recently signed-in one, if several). */
async function findRecipient(db: D1Database, email: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id FROM users WHERE email = ?1 COLLATE NOCASE AND status = 'active'
        ORDER BY last_login_at DESC LIMIT 1`,
    )
    .bind(email)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Tells the sender of a share the decision, unless that account is gone or going. */
function tellSender(c: Ctx, sender: ShareSender, status: 'accepted' | 'rejected'): void {
  defer(c)(
    (async () => {
      const alive = await c.env.DB.prepare(
        "SELECT 1 AS ok FROM users WHERE id = ?1 AND status <> 'deleting'",
      )
        .bind(sender.senderId)
        .first();
      // Never wake (and so recreate) the vault of a deleted account.
      if (alive) await vaultFor(c.env, sender.senderId).shareDecided(sender.shareId, status);
    })(),
  );
}

/** Inbox entries with their senders' current name and address from D1. */
async function withSenders(db: D1Database, entries: InboxEntry[]): Promise<ReceivedShare[]> {
  const ids = [...new Set(entries.map((e) => e.senderId))];
  const senders = new Map<string, { name: string | null; email: string }>();
  if (ids.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT id, email, display_name FROM users
          WHERE id IN (SELECT value FROM json_each(?1)) AND status <> 'deleting'`,
      )
      .bind(JSON.stringify(ids))
      .all<{ id: string; email: string; display_name: string | null }>();
    for (const r of results) senders.set(r.id, { name: r.display_name, email: r.email });
  }
  return entries.map(({ senderId, ...entry }) => ({
    ...entry,
    sender: senders.get(senderId) ?? null,
  }));
}

/**
 * POST /api/shares `{boardId, email}` — always the same 202 whatever the address: the
 * recipient is looked up and the share delivered after the response, so neither the
 * answer nor its timing says whether that account exists.
 */
export async function sendShare(c: Ctx): Promise<Response> {
  const input = SendShareSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return invalid(c);
  const { boardId, email } = input.data;
  const senderId = c.get('user').userId;
  const prepared = await vault(c).prepareShare(boardId, email);
  if ('error' in prepared) {
    switch (prepared.error) {
      case 'not_found':
        return notFound(c);
      case 'rate_limited':
        return rateLimited(c);
      case 'daily_limit':
        return c.json({ error: 'daily_limit' }, 429);
      case 'too_large':
        return c.json({ error: 'too_large' }, 422);
      default:
        return invalid(c);
    }
  }
  const { share, delivery } = prepared;
  defer(c)(
    (async () => {
      const recipient = await findRecipient(c.env.DB, email);
      if (recipient) await vaultFor(c.env, recipient).deliverShare({ ...delivery, senderId });
    })(),
  );
  return c.json({ share }, 202);
}

/** GET /api/shares */
export async function listShares(c: Ctx): Promise<Response> {
  const { received, sent } = await vault(c).listShares();
  const lists: ShareLists = { received: await withSenders(c.env.DB, received), sent };
  return c.json(lists);
}

/** GET /api/shares/received/:id — the package and its photos, to look at before deciding. */
export async function getReceivedShare(c: Ctx): Promise<Response> {
  const id = pathId(c);
  const found = id ? await vault(c).receivedShare(id) : null;
  if (!found) return notFound(c);
  const parsed = BoardPackageSchema.safeParse(JSON.parse(found.package));
  if (!parsed.success) return notFound(c);
  const [share] = await withSenders(c.env.DB, [found.entry]);
  if (!share) return notFound(c);
  const view: ReceivedShareView = { share, package: parsed.data, photos: found.photos };
  return c.json(view);
}

/** GET /api/shares/received/:id/photos/:key */
export async function getReceivedSharePhoto(c: Ctx): Promise<Response> {
  const id = pathId(c);
  const key = pathId(c, 'key');
  const photo = id && key ? await vault(c).receivedSharePhoto(id, key) : null;
  if (!photo) return notFound(c);
  return c.body(photo.data, 200, {
    'Content-Type': photo.mime,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-cache',
  });
}

const ACCEPT_STATUS = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  board_full: 422,
  cell_occupied: 422,
  out_of_bounds: 422,
  too_deep: 422,
  quota_exceeded: 422,
} as const;

/** POST /api/shares/received/:id/accept `{boardId, rev, cell?, name?}` — a new folder with the copy. */
export async function acceptShare(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = AcceptShareSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return invalid(c);
  const result = await vault(c).acceptShare(
    id,
    input.data.boardId,
    input.data.rev,
    input.data.cell,
    input.data.name,
  );
  if ('error' in result) {
    if (result.error === 'rate_limited') return rateLimited(c);
    const status = ACCEPT_STATUS[result.error as keyof typeof ACCEPT_STATUS] ?? 422;
    return c.json({ error: result.error }, status);
  }
  const { totals, sender, ...changes } = result;
  recordTotals(c, c.get('user').userId, totals);
  tellSender(c, sender, 'accepted');
  return c.json(changes);
}

/** POST /api/shares/received/:id/reject */
export async function rejectShare(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const result = await vault(c).rejectShare(id);
  if ('error' in result) {
    return result.error === 'rate_limited' ? rateLimited(c) : notFound(c);
  }
  tellSender(c, result, 'rejected');
  return c.body(null, 204);
}

/** DELETE /api/shares/sent/:id — off the sender's own list (a delivered copy stays). */
export async function removeSentShare(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const result = await vault(c).removeSentShare(id);
  if (typeof result !== 'boolean') return rateLimited(c);
  return result ? c.body(null, 204) : notFound(c);
}
