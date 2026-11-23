import type { Context } from 'hono';
import type { AppContext } from '../context.ts';

/**
 * Every file the extra set can contain (PLAN §4.1). Matched against the *raw* pathname:
 * valid names never need percent-encoding, so any encoded byte (%2e, %2f, %5c, %25…),
 * backslash, dot segment or Unicode look-alike fails the match.
 */
const EXTRA_FILE =
  /^\/sym\/extra\/([gx]\/[0-9]{1,10}\.[0-9a-f]{8}\.webp|(?:index|forms|categories)\.[0-9a-f]{8}\.json|manifest\.json)$/;

/** Upstream host is never resolved: service-binding requests go straight to the Worker. */
const UPSTREAM = 'https://aplikaacja-extra.internal/';

export function extraFile(url: string): string | null {
  return EXTRA_FILE.exec(new URL(url).pathname)?.[1] ?? null;
}

function responseHeaders(file: string, upstream: Response): Headers {
  const headers = new Headers({
    'Content-Type': file.endsWith('.webp') ? 'image/webp' : 'application/json; charset=utf-8',
    // Content-addressed files never change; the manifest is revalidated (ETag → 304).
    'Cache-Control':
      file === 'manifest.json' ? 'private, no-cache' : 'private, max-age=31536000, immutable',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  const etag = upstream.headers.get('ETag');
  if (etag) headers.set('ETag', etag);
  return headers;
}

/** GET /sym/extra/* — session and per-account flag are checked by the route guard. */
export async function serveExtraFile(c: Context<AppContext>): Promise<Response> {
  const file = extraFile(c.req.url);
  if (!file) return c.json({ error: 'not_found' }, 404);
  const binding = c.env.EXTRA_SET;
  if (!binding) return c.json({ error: 'extra_set_unavailable' }, 503);

  // A fresh request: no cookies, no client headers except the validator.
  const forward = new Headers();
  const etag = c.req.header('If-None-Match');
  if (etag && etag.length <= 200) forward.set('If-None-Match', etag);
  let upstream: Response;
  try {
    upstream = await binding.fetch(new Request(UPSTREAM + file, { headers: forward }));
  } catch (err) {
    console.error(JSON.stringify({ msg: 'extra set unreachable', err: String(err) }));
    return c.json({ error: 'extra_set_unavailable' }, 503);
  }
  if (upstream.status === 304) {
    return new Response(null, { status: 304, headers: responseHeaders(file, upstream) });
  }
  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    return c.json({ error: 'not_found' }, 404);
  }
  return new Response(upstream.body, { status: 200, headers: responseHeaders(file, upstream) });
}
