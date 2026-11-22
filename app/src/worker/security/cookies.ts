import type { MiddlewareHandler } from 'hono';
import { OAUTH_COOKIE } from '../auth/oauth-cookie.ts';
import { SESSION_COOKIE } from '../auth/session.ts';
import type { AppContext } from '../context.ts';

const GUARDED = new Set([SESSION_COOKIE, OAUTH_COOKIE]);

/**
 * True when a guarded cookie name occurs more than once in the Cookie header. A host-only
 * `__Host-` cookie can exist once per host, so a repeat means something else injected it
 * (e.g. a nameless cookie from a sibling *.one.pl site, which browsers serialise as a bare
 * `name=value` pair). Names are compared after full whitespace trimming, so look-alike
 * variants padded with Unicode spaces count as repeats too.
 */
export function hasDuplicateGuardedCookie(header: string | undefined): boolean {
  if (!header) return false;
  const seen = new Set<string>();
  for (const part of header.split(';')) {
    const name = part.split('=', 1)[0]?.trim() ?? '';
    if (!GUARDED.has(name)) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

/** Cookie-tossing defence in depth (`one.pl` is not on the Public Suffix List). */
export const cookieConflictGuard: MiddlewareHandler<AppContext> = async (c, next) => {
  if (hasDuplicateGuardedCookie(c.req.header('Cookie'))) {
    return c.json({ error: 'cookie_conflict' }, 400);
  }
  return next();
};
