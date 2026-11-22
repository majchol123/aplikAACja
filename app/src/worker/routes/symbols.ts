import { PutPreferredSchema, type PreferredSymbols } from '@relaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { vaultFor } from '../vault/user-vault.ts';

type Ctx = Context<AppContext>;

export async function getPreferredSymbols(c: Ctx): Promise<Response> {
  const items = await vaultFor(c.env, c.get('user').userId).getPreferredSymbols();
  return c.json({ items } satisfies PreferredSymbols);
}

export async function putPreferredSymbol(c: Ctx): Promise<Response> {
  const input = PutPreferredSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request' }, 400);
  const user = c.get('user');
  // Same rule as for tiles and settings: the extra set only with the grant from D1.
  if (input.data.symbol.set === 'extra' && !user.extraSet) {
    return c.json({ error: 'extra_set_not_enabled' }, 403);
  }
  const result = await vaultFor(c.env, user.userId).putPreferredSymbol(input.data);
  if ('error' in result) {
    return c.json({ error: result.error }, result.error === 'rate_limited' ? 429 : 422);
  }
  return c.json(result);
}
