import { CSRF_HEADER, MeSchema, type Me } from '@aplikaacja/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Same-origin JSON API call; writes carry the CSRF marker header (PLAN §4.1). */
export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const res = await fetch(path, {
    ...rest,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(method !== 'GET' ? { [CSRF_HEADER]: '1' } : {}),
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      typeof body === 'object' && body && 'error' in body ? String(body.error) : 'internal';
    throw new ApiError(res.status, code);
  }
  return body as T;
}

export type Session =
  | { kind: 'user'; me: Me }
  | { kind: 'anon' }
  | { kind: 'blocked' }
  | { kind: 'offline' }
  | { kind: 'unavailable' };

/**
 * Without a connection (or with the server down) the landing page must not look like a
 * logout: the service worker can show the cached page, but the session stays unknown.
 */
export async function loadSession(): Promise<Session> {
  try {
    return { kind: 'user', me: MeSchema.parse(await api('/api/me')) };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === 'blocked') return { kind: 'blocked' };
      if (err.status >= 500) return { kind: 'unavailable' };
      return { kind: 'anon' };
    }
    return { kind: navigator.onLine ? 'unavailable' : 'offline' };
  }
}
