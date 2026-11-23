import { AddHistorySchema, type PhraseItem } from '@relaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { vaultFor } from '../vault/user-vault.ts';

type Ctx = Context<AppContext>;

/** The caller's own vault: always derived from the session, never from the request. */
function vault(c: Ctx) {
  return vaultFor(c.env, c.get('user').userId);
}

/** GET /api/history — newest first. */
export async function listHistory(c: Ctx): Promise<Response> {
  return c.json(await vault(c).listHistory());
}

/**
 * POST /api/history `{entries}` — a device's batch; answers with the whole history. Without
 * the grant, symbols of the extra set are dropped (the words stay): a received board can
 * carry them, and refusing the batch would lose the rest.
 */
export async function addHistory(c: Ctx): Promise<Response> {
  const input = AddHistorySchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request' }, 400);
  const granted = c.get('user').extraSet;
  const strip = (items: PhraseItem[]) =>
    granted ? items : items.map((i) => (i.symbol?.set === 'extra' ? { ...i, symbol: null } : i));
  const result = await vault(c).addHistory(
    input.data.entries.map((e) => ({ at: e.at, items: strip(e.items) })),
  );
  if ('error' in result) return c.json(result, 429);
  return c.json(result);
}

/** DELETE /api/history — everything, on every device. */
export async function clearHistory(c: Ctx): Promise<Response> {
  const result = await vault(c).clearHistory();
  return result === true ? c.body(null, 204) : c.json(result, 429);
}
