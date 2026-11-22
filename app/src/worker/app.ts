import { SettingsPatchSchema, type Me } from '@relaacja/shared';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { routePath } from 'hono/route';
import { z } from 'zod';
import {
  buildAuthorizationUrl,
  exchangeCode,
  OidcError,
  pkceChallenge,
  verifyIdToken,
  type FetchLike,
  type GoogleIdentity,
} from './auth/google.ts';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_TTL_MS,
  openOAuthPayload,
  sealOAuthPayload,
} from './auth/oauth-cookie.ts';
import {
  createSession,
  deleteAllSessions,
  deleteSessionByToken,
  loadSession,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
} from './auth/session.ts';
import { effectiveRole, parseAdminEmails, upsertGoogleUser, type UserRow } from './auth/users.ts';
import type { AppContext } from './context.ts';
import { newToken, sha256Hex } from './lib/crypto.ts';
import { defer } from './lib/defer.ts';
import * as admin from './routes/admin.ts';
import * as boards from './routes/boards.ts';
import * as categories from './routes/categories.ts';
import * as media from './routes/media.ts';
import * as symbols from './routes/symbols.ts';
import { JSON_BODY_LIMIT, ROUTES, type RouteDef } from './routes/registry.ts';
import { cookieConflictGuard } from './security/cookies.ts';
import { csrfGuard } from './security/csrf.ts';
import { securityHeaders } from './security/headers.ts';
import { serveExtraFile } from './symbols/extra-gate.ts';
import { vaultFor } from './vault/user-vault.ts';

export interface AppDeps {
  fetch: FetchLike;
  now: () => number;
}

const defaultDeps: AppDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
};

// Hono's cookie helpers add the "__Host-" prefix themselves when `prefix: 'host'` is set.
const SID = SESSION_COOKIE.replace(/^__Host-/, '');
const OAUTH = OAUTH_COOKIE.replace(/^__Host-/, '');

type Ctx = Context<AppContext>;

function isLocalhost(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function createApp(overrides: Partial<AppDeps> = {}): Hono<AppContext> {
  const deps: AppDeps = { ...defaultDeps, ...overrides };
  const app = new Hono<AppContext>();

  // --- global middleware -----------------------------------------------------
  app.use('*', async (c, next) => {
    const started = deps.now();
    await next();
    const user = c.get('user');
    console.log(
      JSON.stringify({
        method: c.req.method,
        // Route pattern, not the concrete path (keeps target IDs out of logs).
        route: c.res.status === 404 ? null : routePath(c, -1),
        status: c.res.status,
        ms: deps.now() - started,
        // Short hash, never the raw ID or e-mail (PLAN §8).
        user: user ? (await sha256Hex(user.userId)).slice(0, 12) : null,
      }),
    );
  });
  app.use('*', securityHeaders);
  app.use('/api/*', cookieConflictGuard);
  app.use('/sym/extra/*', cookieConflictGuard);
  app.use('/api/*', csrfGuard);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(
      JSON.stringify({ msg: 'unhandled error', route: routePath(c, -1), err: String(err) }),
    );
    return c.json({ error: 'internal' }, 500);
  });

  // --- guards ------------------------------------------------------------------
  const authenticate: MiddlewareHandler<AppContext> = async (c, next) => {
    const token = getCookie(c, SID, 'host');
    const user = await loadSession(c.env.DB, token, deps.now(), defer(c));
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (user.status !== 'active') return c.json({ error: 'blocked' }, 403);
    const role = effectiveRole(user.role, user.email, parseAdminEmails(c.env.ADMIN_EMAILS));
    if (role !== user.role) {
      // Secret changed since the last login: enforce now, persist in the background.
      defer(c)(
        c.env.DB.prepare('UPDATE users SET role = ?1 WHERE id = ?2').bind(role, user.userId).run(),
      );
    }
    c.set('user', { ...user, role });
    return next();
  };

  const requireAdmin: MiddlewareHandler<AppContext> = async (c, next) => {
    const role = c.get('user').role;
    if (role !== 'admin' && role !== 'superadmin') return c.json({ error: 'forbidden' }, 403);
    return next();
  };

  const requireExtraSet: MiddlewareHandler<AppContext> = async (c, next) => {
    // Always from D1 via the session, never from the user's saved settings (PLAN D5).
    if (!c.get('user').extraSet) return c.json({ error: 'extra_set_not_enabled' }, 403);
    return next();
  };

  const devOnly: MiddlewareHandler<AppContext> = async (c, next) => {
    // Three independent conditions; any failure looks exactly like a missing route.
    const enabled =
      c.env.DEV_AUTH === '1' &&
      isLocalhost(c.env.APP_ORIGIN) &&
      isLocalhost(new URL(c.req.url).origin);
    if (!enabled) return c.json({ error: 'not_found' }, 404);
    return next();
  };

  const guards: Record<RouteDef['access'], MiddlewareHandler<AppContext>[]> = {
    public: [],
    user: [authenticate],
    admin: [authenticate, requireAdmin],
    extra: [authenticate, requireExtraSet],
    dev: [devOnly],
  };

  /** The only way to register a route: guard chosen from the registry entry. */
  function defineRoute(def: RouteDef, handler: (c: Ctx) => Response | Promise<Response>): void {
    const limit: MiddlewareHandler<AppContext>[] =
      def.method === 'GET'
        ? []
        : [
            bodyLimit({
              maxSize: def.maxBody ?? JSON_BODY_LIMIT,
              onError: (c) => c.json({ error: 'payload_too_large' }, 413),
            }),
          ];
    const chain: MiddlewareHandler<AppContext>[] = [
      ...guards[def.access],
      ...limit,
      async (c) => handler(c),
    ];
    app.on(def.method, [def.path], ...(chain as [MiddlewareHandler<AppContext>]));
  }

  // --- session helpers -------------------------------------------------------------
  async function startSession(c: Ctx, user: UserRow): Promise<void> {
    // Rotate: never reuse a pre-login session token.
    await deleteSessionByToken(c.env.DB, getCookie(c, SID, 'host'));
    const token = await createSession(c.env.DB, user.id, deps.now());
    setCookie(c, SID, token, {
      prefix: 'host',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
    });
  }

  async function signIn(c: Ctx, identity: GoogleIdentity): Promise<UserRow | null> {
    const admins = parseAdminEmails(c.env.ADMIN_EMAILS);
    const user = await upsertGoogleUser(c.env.DB, identity, admins.has(identity.email), deps.now());
    if (user.status !== 'active') return null;
    await startSession(c, user);
    return user;
  }

  function redirectHome(c: Ctx, error?: string): Response {
    return c.redirect(error ? `/?blad=${error}` : '/', 302);
  }

  // --- routes ------------------------------------------------------------------------
  defineRoute(ROUTES.health, (c) => c.json({ ok: true }));

  defineRoute(ROUTES.login, async (c) => {
    const state = newToken();
    const nonce = newToken();
    const verifier = newToken();
    const sealed = await sealOAuthPayload(c.env.OAUTH_COOKIE_KEY, {
      state,
      nonce,
      verifier,
      exp: deps.now() + OAUTH_COOKIE_TTL_MS,
    });
    setCookie(c, OAUTH, sealed, {
      prefix: 'host',
      httpOnly: true,
      sameSite: 'Lax', // must survive the top-level redirect back from Google
      maxAge: Math.floor(OAUTH_COOKIE_TTL_MS / 1000),
    });
    const url = buildAuthorizationUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: `${c.env.APP_ORIGIN}/api/auth/callback`,
      state,
      nonce,
      codeChallenge: await pkceChallenge(verifier),
    });
    return c.redirect(url, 302);
  });

  defineRoute(ROUTES.callback, async (c) => {
    const sealed = getCookie(c, OAUTH, 'host');
    deleteCookie(c, OAUTH, { prefix: 'host' });
    const query = c.req.query();
    if (query.error)
      return redirectHome(c, query.error === 'access_denied' ? 'anulowano' : 'logowanie');

    const payload = sealed
      ? await openOAuthPayload(c.env.OAUTH_COOKIE_KEY, sealed, deps.now())
      : null;
    if (
      !payload ||
      !query.state ||
      !query.code ||
      query.code.length > 2048 ||
      query.state !== payload.state
    ) {
      return redirectHome(c, 'logowanie');
    }
    try {
      const idToken = await exchangeCode(deps.fetch, {
        code: query.code,
        verifier: payload.verifier,
        clientId: c.env.GOOGLE_CLIENT_ID,
        clientSecret: c.env.GOOGLE_CLIENT_SECRET,
        redirectUri: `${c.env.APP_ORIGIN}/api/auth/callback`,
      });
      const identity = await verifyIdToken(deps.fetch, idToken, {
        clientId: c.env.GOOGLE_CLIENT_ID,
        nonce: payload.nonce,
        now: deps.now(),
      });
      const user = await signIn(c, identity);
      return user ? redirectHome(c) : redirectHome(c, 'zablokowane');
    } catch (err) {
      if (err instanceof OidcError) {
        console.warn(JSON.stringify({ msg: 'oidc rejected', reason: err.message }));
        return redirectHome(c, 'logowanie');
      }
      throw err;
    }
  });

  // Own photos and extra-set images are cached privately by the browser: a logout clears
  // that cache, so the next person on a shared tablet cannot reopen them (best effort,
  // only browsers supporting Clear-Site-Data). Local storage (device settings) stays.
  const CLEAR_CACHE = { 'Clear-Site-Data': '"cache"' };

  defineRoute(ROUTES.logout, async (c) => {
    await deleteSessionByToken(c.env.DB, getCookie(c, SID, 'host'));
    deleteCookie(c, SID, { prefix: 'host' });
    return c.body(null, 204, CLEAR_CACHE);
  });

  defineRoute(ROUTES.logoutAll, async (c) => {
    await deleteAllSessions(c.env.DB, c.get('user').userId);
    deleteCookie(c, SID, { prefix: 'host' });
    return c.body(null, 204, CLEAR_CACHE);
  });

  const DevLoginSchema = z
    .object({
      sub: z.string().min(1).max(64),
      email: z.email().max(320),
      name: z.string().max(200).optional(),
    })
    .strict();

  defineRoute(ROUTES.devLogin, async (c) => {
    const body = DevLoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid_request' }, 400);
    const user = await signIn(c, {
      sub: `dev:${body.data.sub}`,
      email: body.data.email.toLowerCase(),
      name: body.data.name ?? null,
    });
    return user ? c.body(null, 204) : c.json({ error: 'blocked' }, 403);
  });

  defineRoute(ROUTES.me, (c) => {
    const u = c.get('user');
    const me: Me = {
      id: u.userId,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      extraSet: u.extraSet,
    };
    return c.json(me);
  });

  defineRoute(ROUTES.getSettings, async (c) => {
    return c.json(await vaultFor(c.env, c.get('user').userId).getSettings());
  });

  defineRoute(ROUTES.patchSettings, async (c) => {
    const patch = SettingsPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!patch.success) return c.json({ error: 'invalid_request' }, 400);
    const user = c.get('user');
    if (patch.data.activeSets?.includes('extra') && !user.extraSet) {
      return c.json({ error: 'extra_set_not_enabled' }, 403);
    }
    const result = await vaultFor(c.env, user.userId).updateSettings(patch.data);
    if ('error' in result) return c.json(result, 429);
    return c.json(result);
  });

  defineRoute(ROUTES.getBoards, boards.getBoardTree);
  defineRoute(ROUTES.createHomeBoard, boards.createHomeBoard);
  defineRoute(ROUTES.patchBoard, boards.patchBoard);
  defineRoute(ROUTES.createTile, boards.createTile);
  defineRoute(ROUTES.patchTile, boards.patchTile);
  defineRoute(ROUTES.deleteTile, boards.deleteTile);
  defineRoute(ROUTES.moveTile, boards.moveTile);
  defineRoute(ROUTES.getPreferredSymbols, symbols.getPreferredSymbols);
  defineRoute(ROUTES.putPreferredSymbol, symbols.putPreferredSymbol);
  defineRoute(ROUTES.getCategoryIcons, categories.getCategoryIcons);
  defineRoute(ROUTES.putCategoryIcon, categories.putCategoryIcon(deps.now));
  defineRoute(ROUTES.listMedia, media.listMedia);
  defineRoute(ROUTES.uploadMedia, media.uploadMedia);
  defineRoute(ROUTES.getMedia, media.getMedia);
  defineRoute(ROUTES.renameMedia, media.renameMedia);
  defineRoute(ROUTES.deleteMedia, media.deleteMedia);

  defineRoute(ROUTES.adminUsers, admin.listUsers);
  defineRoute(ROUTES.adminBlock, admin.blockUser(deps.now));
  defineRoute(ROUTES.adminUnblock, admin.unblockUser(deps.now));
  defineRoute(ROUTES.adminExtraSet, admin.setExtraSet(deps.now));
  defineRoute(ROUTES.adminRole, admin.setRole(deps.now));
  defineRoute(ROUTES.adminDelete, admin.deleteUser(deps.now));
  defineRoute(ROUTES.adminUserData, admin.userData(deps.now));
  defineRoute(ROUTES.adminUserMedia, admin.userMedia);
  defineRoute(ROUTES.adminAudit, admin.listAudit);

  defineRoute(ROUTES.extraAsset, serveExtraFile);

  return app;
}
