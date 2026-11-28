/**
 * What the service worker does with a request (PLAN D11, §4.1 "shared tablet"). It caches
 * only what is public and identical for every account: hashed app files, the static pages
 * and the ARASAAC mirror. The API, own photos and the extra set (licensed per
 * account) are never touched, so nothing personal outlives a logout in CacheStorage.
 */
export type Strategy = 'network' | 'page' | 'shell' | 'symbols' | 'tts';

/** Bump a name when the format of its entries changes; activation drops other caches. */
export const CACHES = {
  pages: 'aplikaacja-pages-v1',
  shell: 'aplikaacja-shell-v1',
  symbols: 'aplikaacja-arasaac-v1',
  tts: 'aplikaacja-tts-v1',
} as const;

/** Old app files of earlier deploys and rarely used symbols are dropped beyond this. */
export const LIMITS = { shell: 200, symbols: 4000, tts: 16 } as const;

/** The static documents (index.html is both the landing page and the app). */
export const PAGES: ReadonlySet<string> = new Set(['/', '/prywatnosc', '/o-aplikacji', '/pomoc']);

const ARASAAC_FILE =
  /^\/sym\/arasaac\/(?:p\/[0-9]{1,10}\.[0-9a-f]{8}\.webp|(?:index|forms|categories|grammar)\.[0-9a-f]{8}\.json)$/;
const TTS_RUNTIME_FILE = /^\/tts\/runtime\/[0-9a-f]{8}\/[A-Za-z0-9._-]+$/;
const APP_FILE = /^\/assets\/[A-Za-z0-9._-]+$/;

export function strategyFor(url: URL, origin: string, method: string, mode: string): Strategy {
  if (method !== 'GET' || url.origin !== origin) return 'network';
  if (mode === 'navigate') return PAGES.has(url.pathname) ? 'page' : 'network';
  if (ARASAAC_FILE.test(url.pathname)) return 'symbols';
  if (TTS_RUNTIME_FILE.test(url.pathname)) return 'tts';
  if (APP_FILE.test(url.pathname)) return 'shell';
  return 'network';
}

/** Index, lexicons and category tree of the mirror: only the newest of each is worth keeping. */
export function supersededBy(pathname: string): string | null {
  const match = /^(\/sym\/arasaac\/(?:index|forms|categories|grammar)\.)[0-9a-f]{8}\.json$/.exec(
    pathname,
  );
  return match?.[1] ?? null;
}

/** True when `existingPath` is an older version of the same asset replaced by `newPath`. */
export function isSupersededAsset(existingPath: string, newPath: string): boolean {
  if (existingPath === newPath) return false;
  const prefix = supersededBy(newPath);
  if (prefix && existingPath.startsWith(prefix)) return true;
  const ttsNew = /^\/tts\/runtime\/([0-9a-f]{8})\/([A-Za-z0-9._-]+)$/.exec(newPath);
  const ttsOld = /^\/tts\/runtime\/([0-9a-f]{8})\/([A-Za-z0-9._-]+)$/.exec(existingPath);
  return Boolean(ttsNew && ttsOld && ttsNew[1] !== ttsOld[1] && ttsNew[2] === ttsOld[2]);
}
