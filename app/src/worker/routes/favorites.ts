import { AddFavoriteSchema, ObjectIdSchema } from '@aplikaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { vaultFor } from '../vault/user-vault.ts';

type Ctx = Context<AppContext>;

/** The caller's own vault: always derived from the session, never from the request. */
function vault(c: Ctx) {
  return vaultFor(c.env, c.get('user').userId);
}

/** GET /api/favorites */
export async function listFavorites(c: Ctx): Promise<Response> {
  return c.json(await vault(c).listFavorites());
}

/** POST /api/favorites `{items}` — the extra set only with the grant, as on tiles. */
export async function addFavorite(c: Ctx): Promise<Response> {
  const input = AddFavoriteSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'invalid_request' }, 400);
  if (input.data.items.some((i) => i.symbol?.set === 'extra') && !c.get('user').extraSet) {
    return c.json({ error: 'extra_set_not_enabled' }, 403);
  }
  const result = await vault(c).addFavorite(input.data.items);
  if ('error' in result) {
    return c.json(result, result.error === 'rate_limited' ? 429 : 422);
  }
  return c.json(result, 201);
}

/** DELETE /api/favorites/:id */
export async function removeFavorite(c: Ctx): Promise<Response> {
  const id = c.req.param('id');
  if (!id || !ObjectIdSchema.safeParse(id).success) return c.json({ error: 'not_found' }, 404);
  const result = await vault(c).removeFavorite(id);
  if (typeof result !== 'boolean') return c.json(result, 429);
  return result ? c.body(null, 204) : c.json({ error: 'not_found' }, 404);
}
