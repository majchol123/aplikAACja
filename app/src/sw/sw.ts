/// <reference lib="webworker" />
import { CACHES, LIMITS, strategyFor, supersededBy } from './routes.ts';

/**
 * Service worker (PLAN D11): no offline mode, only a faster start and a clear message when
 * the network is gone. Documents are fetched from the network first (a cached copy is used
 * only without a connection); hashed app files and ARASAAC symbols come from the cache.
 */
declare const self: ServiceWorkerGlobalScope;

let stored = 0;

self.addEventListener('install', () => {
  // Everything cached is immutable or network-first, so a new version can take over at once.
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set<string>(Object.values(CACHES));
      for (const name of await caches.keys()) {
        if (name.startsWith('aplikaacja-') && !keep.has(name)) await caches.delete(name);
      }
      await Promise.all([trim(CACHES.shell, LIMITS.shell), trim(CACHES.symbols, LIMITS.symbols)]);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const strategy = strategyFor(url, self.location.origin, request.method, request.mode);
  if (strategy === 'network') return; // the browser handles it as if there were no worker
  event.respondWith(strategy === 'page' ? page(request, url) : cached(event, url, strategy));
});

async function page(request: Request, url: URL): Promise<Response> {
  const cache = await caches.open(CACHES.pages);
  try {
    const response = await fetch(request);
    if (response.status === 200 && response.headers.get('Content-Type')?.startsWith('text/html')) {
      await cache.put(url.pathname, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(url.pathname)) ?? (await cache.match('/')) ?? Response.error();
  }
}

async function cached(
  event: FetchEvent,
  url: URL,
  strategy: 'shell' | 'symbols',
): Promise<Response> {
  const cache = await caches.open(CACHES[strategy]);
  const hit = await cache.match(url.pathname);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.status === 200 && response.type === 'basic') {
    event.waitUntil(store(cache, url.pathname, response.clone(), strategy));
  }
  return response;
}

async function store(
  cache: Cache,
  pathname: string,
  response: Response,
  strategy: 'shell' | 'symbols',
): Promise<void> {
  await cache.put(pathname, response);
  const prefix = supersededBy(pathname);
  if (prefix) {
    for (const key of await cache.keys()) {
      const path = new URL(key.url).pathname;
      if (path !== pathname && path.startsWith(prefix)) await cache.delete(key);
    }
  }
  if (++stored % 100 === 0) await trim(CACHES[strategy], LIMITS[strategy]);
}

/** Keeps the newest `limit` entries (CacheStorage lists keys in insertion order). */
async function trim(name: string, limit: number): Promise<void> {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}
