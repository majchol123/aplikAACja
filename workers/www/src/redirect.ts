/** The app's only origin; www.aplikaacja.one.pl sends everything there. */
export const APP_ORIGIN = 'https://aplikaacja.one.pl';

// Same as the app (app/src/worker/security/headers.ts): once a browser has followed
// http://www…, it keeps to HTTPS on that host too.
const HSTS = 'max-age=63072000; includeSubDomains';

/**
 * Permanent redirect to the same path and query on the app origin. The target is built from
 * the fixed origin, so no request (`//evil.example`, an odd Host header) can point it elsewhere.
 */
export function redirect(request: Request): Response {
  const { pathname, search } = new URL(request.url);
  return new Response(null, {
    status: 301,
    headers: { Location: `${APP_ORIGIN}${pathname}${search}`, 'Strict-Transport-Security': HSTS },
  });
}
