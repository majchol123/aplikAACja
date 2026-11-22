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
  /** Active account with the optional extra symbol set granted (users.extra_set_enabled). */
  | 'extra'
  /** Fake login for local E2E; 404 everywhere else. */
  | 'dev';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: Method;
  path: string;
  access: Access;
  /** Request body cap in bytes for non-GET routes (default JSON_BODY_LIMIT). */
  maxBody?: number;
}

export const JSON_BODY_LIMIT = 16 * 1024;

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
  // Board tree (PLAN §3.5); IDs in paths are only looked up inside the caller's own vault.
  getBoards: { method: 'GET', path: '/api/boards', access: 'user' },
  createHomeBoard: { method: 'POST', path: '/api/boards/home', access: 'user' },
  patchBoard: { method: 'PATCH', path: '/api/boards/:id', access: 'user' },
  createTile: { method: 'POST', path: '/api/boards/:id/tiles', access: 'user' },
  patchTile: { method: 'PATCH', path: '/api/tiles/:id', access: 'user' },
  deleteTile: { method: 'DELETE', path: '/api/tiles/:id', access: 'user' },
  moveTile: { method: 'POST', path: '/api/tiles/move', access: 'user' },
  // Preferred variant of a word (PLAN §2.2).
  getPreferredSymbols: { method: 'GET', path: '/api/symbols/preferred', access: 'user' },
  putPreferredSymbol: { method: 'PUT', path: '/api/symbols/preferred', access: 'user' },
  adminUsers: { method: 'GET', path: '/api/admin/users', access: 'admin' },
  /** Gate in front of the private extra-set Worker (PLAN D5, §4.1 path traversal). */
  extraAsset: { method: 'GET', path: '/sym/extra/*', access: 'extra' },
} as const satisfies Record<string, RouteDef>;

export type RouteName = keyof typeof ROUTES;
