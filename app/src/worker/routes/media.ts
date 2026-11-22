import {
  MEDIA_LIMITS,
  MediaLabelSchema,
  ObjectIdSchema,
  PatchMediaSchema,
  type MediaUsage,
} from '@relaacja/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext } from '../context.ts';
import { defer } from '../lib/defer.ts';
import { cleanImage, type ImageProblem } from '../media/image.ts';
import { vaultFor } from '../vault/user-vault.ts';

type Ctx = Context<AppContext>;

const IMAGE_STATUS: Record<ImageProblem, ContentfulStatusCode> = {
  unsupported_type: 415,
  invalid_image: 400,
  too_large: 422,
};

/** The caller's own vault: always derived from the session, never from the request. */
function vault(c: Ctx) {
  return vaultFor(c.env, c.get('user').userId);
}

/** Malformed IDs cannot exist in any vault: same 404 as an unknown one. */
function pathId(c: Ctx): string | null {
  const id = c.req.param('id');
  return ObjectIdSchema.safeParse(id).success ? (id ?? null) : null;
}

const invalid = (c: Ctx) => c.json({ error: 'invalid_request' }, 400);
const notFound = (c: Ctx) => c.json({ error: 'not_found' }, 404);

/** Storage used per account, for the admin overview (D1, after the response). */
function recordUsage(c: Ctx, usage: MediaUsage): void {
  defer(c)(
    c.env.DB.prepare('UPDATE users SET storage_bytes = ?1 WHERE id = ?2')
      .bind(usage.bytes, c.get('user').userId)
      .run(),
  );
}

export async function listMedia(c: Ctx): Promise<Response> {
  return c.json(await vault(c).getMediaList());
}

/** multipart/form-data: `label` (photo name) and `image` (already re-encoded by the browser). */
export async function uploadMedia(c: Ctx): Promise<Response> {
  if (!/^multipart\/form-data;/i.test(c.req.header('Content-Type') ?? '')) return invalid(c);
  const form = await c.req.parseBody().catch(() => null);
  const label = MediaLabelSchema.safeParse(form?.label);
  const file = form?.image;
  if (!label.success || !(file instanceof File)) return invalid(c);
  if (file.size > MEDIA_LIMITS.maxFileBytes) return c.json({ error: 'payload_too_large' }, 413);

  const image = cleanImage(new Uint8Array(await file.arrayBuffer()));
  if ('error' in image) return c.json({ error: image.error }, IMAGE_STATUS[image.error]);
  const result = await vault(c).putMedia(label.data, image);
  if ('error' in result) {
    return c.json({ error: result.error }, result.error === 'rate_limited' ? 429 : 422);
  }
  recordUsage(c, result.usage);
  return c.json(result, 201);
}

export async function getMedia(c: Ctx): Promise<Response> {
  const id = pathId(c);
  const media = id ? await vault(c).getMedia(id) : null;
  if (!media) return notFound(c);
  // Never rendered as a document: nosniff, CSP sandbox and CORP come from securityHeaders.
  return c.body(media.data, 200, {
    'Content-Type': media.mime,
    'Content-Disposition': 'inline',
    // IDs are random and a stored photo never changes; kept by this browser only.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
}

export async function renameMedia(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const input = PatchMediaSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return invalid(c);
  const result = await vault(c).renameMedia(id, input.data.label);
  if ('error' in result) {
    return result.error === 'not_found' ? notFound(c) : c.json({ error: result.error }, 429);
  }
  return c.json(result);
}

export async function deleteMedia(c: Ctx): Promise<Response> {
  const id = pathId(c);
  if (!id) return notFound(c);
  const result = await vault(c).deleteMedia(id);
  if ('error' in result) {
    if (result.error === 'not_found') return notFound(c);
    return c.json({ error: result.error }, result.error === 'rate_limited' ? 429 : 409);
  }
  recordUsage(c, result.usage);
  return c.json(result);
}
