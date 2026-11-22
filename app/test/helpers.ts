import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { CSRF_HEADER } from '@relaacja/shared';
import { createApp, type AppDeps } from '../src/worker/app.ts';
import { createSession } from '../src/worker/auth/session.ts';
import type { AppEnv } from '../src/worker/env.ts';
import { newId } from '../src/worker/lib/crypto.ts';

export const ORIGIN = 'http://localhost:5173';

export interface TestClock {
  now: number;
}

export function makeApp(deps: Partial<AppDeps> = {}, clock: TestClock = { now: Date.now() }) {
  const app = createApp({ now: () => clock.now, ...deps });
  async function call(
    path: string,
    init: RequestInit = {},
    envOverride: Partial<AppEnv> = {},
  ): Promise<Response> {
    const ctx = createExecutionContext();
    const res = await app.request(
      `${path.startsWith('http') ? '' : ORIGIN}${path}`,
      init,
      { ...env, ...envOverride },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  }
  return { app, call, clock };
}

/** Headers a legitimate same-origin SPA request carries on writes. */
export function writeHeaders(cookie?: string): Record<string, string> {
  return {
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    [CSRF_HEADER]: '1',
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

export interface TestUser {
  id: string;
  email: string;
}

export async function insertUser(
  opts: {
    role?: 'user' | 'admin' | 'superadmin';
    status?: 'active' | 'blocked' | 'deleting';
    extraSet?: boolean;
    email?: string;
  } = {},
): Promise<TestUser> {
  const id = newId();
  const email = opts.email ?? `${id}@example.com`;
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, display_name, role, status, extra_set_enabled, created_at)
     VALUES (?1, ?2, ?3, 'Test', ?4, ?5, ?6, ?7)`,
  )
    .bind(
      id,
      `sub-${id}`,
      email,
      opts.role ?? 'user',
      opts.status ?? 'active',
      opts.extraSet ? 1 : 0,
      Date.now(),
    )
    .run();
  return { id, email };
}

export async function sessionCookie(userId: string, now = Date.now()): Promise<string> {
  const token = await createSession(env.DB, userId, now);
  return `__Host-relaacja_sid=${token}`;
}

/** Extracts `name=value` pairs from Set-Cookie headers. */
export function setCookies(res: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const idx = pair!.indexOf('=');
    out[pair!.slice(0, idx)] = { value: pair!.slice(idx + 1), raw };
  }
  return out;
}
