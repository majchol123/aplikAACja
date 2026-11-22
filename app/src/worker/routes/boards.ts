import {
  CreateHomeSchema,
  CreateTileSchema,
  MoveTileSchema,
  ObjectIdSchema,
  PatchBoardSchema,
  PatchTileSchema,
  type SymbolRef,
} from '@relaacja/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { AppContext } from '../context.ts';
import type { BoardErrorCode } from '../vault/boards.ts';
import { vaultFor, type BoardResult } from '../vault/user-vault.ts';
import { recordTotals } from './totals.ts';

type Ctx = Context<AppContext>;

const ERROR_STATUS: Record<BoardErrorCode | 'rate_limited', ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  // Stale `rev` or state the client did not expect: it should reload the tree.
  conflict: 409,
  already_initialized: 409,
  cell_occupied: 422,
  out_of_bounds: 422,
  invalid_move: 422,
  too_deep: 422,
  quota_exceeded: 422,
  unknown_symbol: 422,
  board_full: 422,
  rate_limited: 429,
};

/** The caller's own vault: always derived from the session, never from the request. */
function vault(c: Ctx) {
  return vaultFor(c.env, c.get('user').userId);
}

async function readBody<T>(c: Ctx, schema: z.ZodType<T>): Promise<T | null> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Malformed IDs cannot exist in any vault: same 404 as an unknown one. */
function pathId(c: Ctx): string | null {
  const id = c.req.param('id');
  return ObjectIdSchema.safeParse(id).success ? (id ?? null) : null;
}

const invalid = (c: Ctx) => c.json({ error: 'invalid_request' }, 400);
const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);

/** Same rule as for settings: the extra set only with the per-account grant from D1. */
function extraRefused(c: Ctx, symbol: SymbolRef | null | undefined): Response | null {
  if (symbol?.set === 'extra' && !c.get('user').extraSet) {
    return c.json({ error: 'extra_set_not_enabled' }, 403);
  }
  return null;
}

function answer(c: Ctx, result: BoardResult, status: ContentfulStatusCode = 200): Response {
  if ('error' in result) return c.json({ error: result.error }, ERROR_STATUS[result.error]);
  const { totals, ...changes } = result;
  recordTotals(c, c.get('user').userId, totals);
  return c.json(changes, status);
}

/** At most a few validators; anything longer is ignored rather than parsed. */
function knownEtags(header: string | undefined): string[] {
  if (!header || header.length > 512) return [];
  return header
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function getBoardTree(c: Ctx): Promise<Response> {
  const { etag, json, totals } = await vault(c).getBoardTree(
    knownEtags(c.req.header('If-None-Match')),
  );
  // Also how accounts that only use their boards get counted in the admin panel.
  recordTotals(c, c.get('user').userId, totals);
  if (json === null) return c.body(null, 304, { ETag: etag });
  return c.body(json, 200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag });
}

/**
 * POST /api/boards/:id/import `{rev, package}` — a board read from a file. The body is
 * handed to the vault unparsed (parsing a large package would eat the Worker's CPU time).
 */
export async function importPackage(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const body = await c.req.text();
  if (!body) return invalid(c);
  return answer(c, await vault(c).importPackage(id, body));
}

export async function createHomeBoard(c: Ctx): Promise<Response> {
  const input = await readBody(c, CreateHomeSchema);
  if (!input) return invalid(c);
  return answer(c, await vault(c).createHomeBoard(input), 201);
}

export async function patchBoard(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = await readBody(c, PatchBoardSchema);
  if (!input) return invalid(c);
  return answer(c, await vault(c).patchBoard(id, input));
}

export async function createTile(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = await readBody(c, CreateTileSchema);
  if (!input) return invalid(c);
  return extraRefused(c, input.symbol) ?? answer(c, await vault(c).createTile(id, input), 201);
}

export async function patchTile(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = await readBody(c, PatchTileSchema);
  if (!input) return invalid(c);
  return extraRefused(c, input.symbol) ?? answer(c, await vault(c).patchTile(id, input));
}

/** DELETE carries no body: the board revision comes as `?rev=`. */
export async function deleteTile(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const rev = c.req.query('rev') ?? '';
  if (!/^[1-9][0-9]{0,14}$/.test(rev)) return invalid(c);
  return answer(c, await vault(c).deleteTile(id, Number(rev)));
}

export async function moveTile(c: Ctx): Promise<Response> {
  const input = await readBody(c, MoveTileSchema);
  if (!input) return invalid(c);
  return answer(c, await vault(c).moveTile(input));
}
