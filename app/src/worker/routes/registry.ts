/**
 * Single source of truth for every API route and who may call it. Routes can only be
 * registered through `defineRoute` (app.ts), which attaches the matching guard. The
 * authorization-matrix test fails if a route exists without an explicit expectation.
 */
export type Access =
  /** No session required. */
  | 'public'
  /** Active account. */
  | 'user'
  /** Active account with role admin or superadmin. */
  | 'admin'
  /** Fake login for local E2E; 404 everywhere else. */
  | 'dev';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: Method;
  path: string;
  access: Access;
}

export const ROUTES = {
  health: { method: 'GET', path: '/api/health', access: 'public' },
  login: { method: 'GET', path: '/api/auth/login', access: 'public' },
  callback: { method: 'GET', path: '/api/auth/callback', access: 'public' },
  logout: { method: 'POST', path: '/api/auth/logout', access: 'public' },
  logoutAll: { method: 'POST', path: '/api/auth/logout-all', access: 'user' },
  devLogin: { method: 'POST', path: '/api/auth/dev-login', access: 'dev' },
  me: { method: 'GET', path: '/api/me', access: 'user' },
  getSettings: { method: 'GET', path: '/api/settings', access: 'user' },
  patchSettings: { method: 'PATCH', path: '/api/settings', access: 'user' },
  adminUsers: { method: 'GET', path: '/api/admin/users', access: 'admin' },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof ROUTES;
