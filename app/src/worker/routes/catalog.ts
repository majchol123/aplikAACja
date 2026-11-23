import {
  AcceptShareSchema,
  BoardPackageSchema,
  ObjectIdSchema,
  PatchCatalogSchema,
  ReplaceCatalogSchema,
  PublishCatalogSchema,
  type CatalogView,
} from '@relaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { catalogFor } from '../catalog/catalog.ts';
import { auditStatement } from '../lib/audit.ts';
import { vaultFor } from '../vault/user-vault.ts';
import { recordTotals } from './totals.ts';

/**
 * Catalogue of public boards (PLAN §2.8): every signed-in account browses it and copies
 * from it; admins publish copies of their own boards, rename, describe and withdraw them,
 * each change in admin_audit.
 */
type Ctx = Context<AppContext>;

const invalid = (c: Ctx) => c.json({ error: 'invalid_request' }, 400);
const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);

function pathId(c: Ctx, name = 'id'): string | null {
  const id = c.req.param(name);
  return id && ObjectIdSchema.safeParse(id).success ? id : null;
}

/** GET /api/catalog */
export async function listCatalog(c: Ctx): Promise<Response> {
  return c.json({ entries: await catalogFor(c.env).list() });
}

/** GET /api/catalog/:id */
export async function getCatalogEntry(c: Ctx): Promise<Response> {
  const id = pathId(c);
  const found = id ? await catalogFor(c.env).entry(id) : null;
  if (!found) return notFound(c);
  const parsed = BoardPackageSchema.safeParse(JSON.parse(found.package));
  if (!parsed.success) return notFound(c);
  const view: CatalogView = { entry: found.entry, package: parsed.data, photos: found.photos };
  return c.json(view);
}

/** GET /api/catalog/:id/photos/:key */
export async function getCatalogPhoto(c: Ctx): Promise<Response> {
  const id = pathId(c);
  const key = pathId(c, 'key');
  const photo = id && key ? await catalogFor(c.env).photo(id, key) : null;
  if (!photo) return notFound(c);
  return c.body(photo.data, 200, {
    'Content-Type': photo.mime,
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, max-age=3600',
  });
}

const PLACE_STATUS = {
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  board_full: 422,
  cell_occupied: 422,
  out_of_bounds: 422,
  too_deep: 422,
  quota_exceeded: 422,
} as const;

/** POST /api/catalog/:id/import `{boardId, rev}` — a copy as a new folder on one's board. */
export async function importCatalogEntry(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = AcceptShareSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return invalid(c);
  const copy = await catalogFor(c.env).copy(id);
  if (!copy) return notFound(c);
  const user = c.get('user');
  const result = await vaultFor(c.env, user.userId).importFromCatalog(
    input.data.boardId,
    input.data.rev,
    copy.package,
    copy.files,
    input.data.cell,
  );
  if ('error' in result) {
    if (result.error === 'rate_limited') return c.json({ error: 'rate_limited' }, 429);
    const status = PLACE_STATUS[result.error as keyof typeof PLACE_STATUS] ?? 422;
    return c.json({ error: result.error }, status);
  }
  const { totals, ...changes } = result;
  recordTotals(c, user.userId, totals);
  return c.json(changes);
}

/** POST /api/admin/catalog `{boardId, name, description, includePhotos}` */
export function publishCatalog(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = PublishCatalogSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return invalid(c);
    const user = c.get('user');
    const built = await vaultFor(c.env, user.userId).exportForCatalog(
      input.data.boardId,
      input.data.includePhotos,
      input.data.name,
    );
    if ('error' in built) {
      if (built.error === 'not_found') return notFound(c);
      return c.json({ error: built.error }, built.error === 'too_large' ? 422 : 429);
    }
    const entry = await catalogFor(c.env).publish({
      ...built.counts,
      name: input.data.name,
      description: input.data.description,
      package: built.package,
      files: built.files,
      publishedBy: user.userId,
    });
    if ('error' in entry) return c.json({ error: entry.error }, 422);
    await auditStatement(c.env.DB, {
      at: now(),
      actor: user.userId,
      action: 'catalog.publish',
      details: { entry: entry.id, name: entry.name, photos: entry.photos },
    }).run();
    return c.json(entry, 201);
  };
}

/** PATCH /api/admin/catalog/:id `{name?, description?}` */
export function patchCatalog(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const id = pathId(c);
    if (!id) return notFound(c);
    const input = PatchCatalogSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return invalid(c);
    const entry = await catalogFor(c.env).update(id, input.data);
    if (!entry) return notFound(c);
    await auditStatement(c.env.DB, {
      at: now(),
      actor: c.get('user').userId,
      action: 'catalog.edit',
      details: { entry: id, name: entry.name },
    }).run();
    return c.json(entry);
  };
}

/** PUT /api/admin/catalog/:id/content `{boardId, includePhotos}` — a new version. */
export function replaceCatalog(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const id = pathId(c);
    if (!id) return notFound(c);
    const input = ReplaceCatalogSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return invalid(c);
    const user = c.get('user');
    const built = await vaultFor(c.env, user.userId).exportForCatalog(
      input.data.boardId,
      input.data.includePhotos,
    );
    if ('error' in built) {
      if (built.error === 'not_found') return notFound(c);
      return c.json({ error: built.error }, built.error === 'too_large' ? 422 : 429);
    }
    const entry = await catalogFor(c.env).replace(id, {
      ...built.counts,
      package: built.package,
      files: built.files,
    });
    if (!entry) return notFound(c);
    await auditStatement(c.env.DB, {
      at: now(),
      actor: user.userId,
      action: 'catalog.update',
      details: { entry: id, name: entry.name, photos: entry.photos },
    }).run();
    return c.json(entry);
  };
}

/** DELETE /api/admin/catalog/:id — copies already made stay in their accounts. */
export function withdrawCatalog(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const id = pathId(c);
    const gone = id ? await catalogFor(c.env).withdraw(id) : null;
    if (!id || !gone) return notFound(c);
    await auditStatement(c.env.DB, {
      at: now(),
      actor: c.get('user').userId,
      action: 'catalog.withdraw',
      details: { entry: id, name: gone.name },
    }).run();
    return c.body(null, 204);
  };
}
