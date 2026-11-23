import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { CSRF_HEADER } from '@aplikaacja/shared';
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
    createdAt?: number;
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
      opts.createdAt ?? Date.now(),
    )
    .run();
  return { id, email };
}

export async function sessionCookie(userId: string, now = Date.now()): Promise<string> {
  const token = await createSession(env.DB, userId, now);
  return `__Host-aplikaacja_sid=${token}`;
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

/** JSON API client for one session (writes carry the CSRF headers). */
export function apiAs(call: ReturnType<typeof makeApp>['call'], cookie: string) {
  return async function api<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T; res: Response }> {
    const init: RequestInit =
      method === 'GET'
        ? { headers: { Cookie: cookie, ...headers } }
        : {
            method,
            headers: { ...writeHeaders(cookie), ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          };
    const res = await call(path, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, res };
  };
}

/** Write headers for a multipart body: the form sets Content-Type (with its boundary). */
export function formHeaders(cookie?: string): Record<string, string> {
  const headers = writeHeaders(cookie);
  delete headers['Content-Type'];
  return headers;
}

/** Multipart form of a photo upload, as the SPA builds it. */
export function photoForm(
  label: string | undefined,
  image: Uint8Array | string,
  type = 'image/webp',
) {
  const form = new FormData();
  if (label !== undefined) form.set('label', label);
  form.set('image', new File([image], 'zdjecie', { type }));
  return form;
}

/** Photo upload for one session: CSRF headers, Content-Type (with boundary) from the form. */
export function uploadAs(call: ReturnType<typeof makeApp>['call'], cookie: string) {
  return async function upload<T = unknown>(
    label: string | undefined,
    image: Uint8Array | string,
    type?: string,
  ): Promise<{ status: number; body: T; res: Response }> {
    const res = await call('/api/media', {
      method: 'POST',
      headers: formHeaders(cookie),
      body: photoForm(label, image, type),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, res };
  };
}
