import { CSRF_HEADER } from '@relaacja/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppContext } from '../context.ts';
import { MULTIPART_ROUTES } from '../routes/registry.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `one.pl` is not on the Public Suffix List, so every *.one.pl site is "same-site" and
 * SameSite cookies do not stop cross-subdomain request forgery. State-changing requests
 * therefore must prove same-origin explicitly (PLAN §4.1):
 *  - exact Origin match (no prefix/suffix logic),
 *  - Sec-Fetch-Site, when the browser sends it, must be "same-origin",
 *  - custom header (forces a CORS preflight cross-origin, which we never grant),
 *  - JSON content type (or none for empty bodies); multipart/form-data only on the
 *    photo upload route (RouteDef.multipart).
 */
export const csrfGuard: MiddlewareHandler<AppContext> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header('Origin');
  const fetchSite = c.req.header('Sec-Fetch-Site');
  const marker = c.req.header(CSRF_HEADER);
  const contentType = c.req.header('Content-Type') ?? '';
  const bodyTypeOk =
    contentType === '' ||
    /^application\/json(;|$)/i.test(contentType) ||
    (MULTIPART_ROUTES.has(`${c.req.method} ${c.req.path}`) &&
      /^multipart\/form-data;/i.test(contentType));

  if (
    origin !== c.env.APP_ORIGIN ||
    (fetchSite !== undefined && fetchSite !== 'same-origin') ||
    marker !== '1' ||
    !bodyTypeOk
  ) {
    return c.json({ error: 'csrf' }, 403);
  }
  return next();
};
