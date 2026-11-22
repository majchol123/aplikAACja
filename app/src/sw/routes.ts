/**
 * What the service worker does with a request (PLAN D11, §4.1 "shared tablet"). It caches
 * only what is public and identical for every account: hashed app files, the three static
 * pages and the ARASAAC mirror. The API, own photos and the extra set (licensed per
 * account) are never touched, so nothing personal outlives a logout in CacheStorage.
 */
export type Strategy = 'network' | 'page' | 'shell' | 'symbols';

/** Bump a name when the format of its entries changes; activation drops other caches. */
export const CACHES = {
  pages: 'relaacja-pages-v1',
  shell: 'relaacja-shell-v1',
  symbols: 'relaacja-arasaac-v1',
} as const;

/** Old app files of earlier deploys and rarely used symbols are dropped beyond this. */
export const LIMITS = { shell: 200, symbols: 4000 } as const;

/** The static documents (index.html is both the landing page and the app). */
export const PAGES: ReadonlySet<string> = new Set(['/', '/prywatnosc', '/o-aplikacji']);

const ARASAAC_FILE =
  /^\/sym\/arasaac\/(?:p\/[0-9]{1,10}\.[0-9a-f]{8}\.webp|(?:index|forms)\.[0-9a-f]{8}\.json)$/;
const APP_FILE = /^\/assets\/[A-Za-z0-9._-]+$/;

export function strategyFor(url: URL, origin: string, method: string, mode: string): Strategy {
  if (method !== 'GET' || url.origin !== origin) return 'network';
  if (mode === 'navigate') return PAGES.has(url.pathname) ? 'page' : 'network';
  if (ARASAAC_FILE.test(url.pathname)) return 'symbols';
  if (APP_FILE.test(url.pathname)) return 'shell';
  return 'network';
}

/** Index and lexicon of the mirror: only the newest of each is worth keeping. */
export function supersededBy(pathname: string): string | null {
  const match = /^(\/sym\/arasaac\/(?:index|forms)\.)[0-9a-f]{8}\.json$/.exec(pathname);
  return match?.[1] ?? null;
}
