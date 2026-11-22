import type { MiddlewareHandler } from 'hono';

/**
 * Content Security Policy for HTML documents. Mirrored into the static `_headers` file at
 * build time (vite.config.ts) so assets served without invoking the Worker get it too.
 */
/**
 * The drag-and-drop library (@dnd-kit/dom, pinned) injects three fixed <style> elements while
 * a tile is dragged: the dragged tile's movement, the grabbing cursor and no text selection.
 * They are allowed by hash, not with 'unsafe-inline'. A new library version that changes
 * them fails the E2E suite (CSP violations are console errors) with the new hashes.
 */
const DND_KIT_STYLES = [
  "'sha256-E7zJXfkufcgTIQG1Th6iYnoGis+rTfZd044bgiM1kr4='", // Feedback
  "'sha256-P3zrZWkaCzrI/B9T0+WLFRTTY8rvTIfnbvP5TBI9Vgo='", // Cursor
  "'sha256-YYLJe/bgx7gKdFc8dp3EM3/S8hpKeZs7JyhfBoZYPuk='", // PreventSelection
];

export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' ${DND_KIT_STYLES.join(' ')}`,
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const COMMON_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** API responses: never cached, never rendered as a document. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  ...COMMON_SECURITY_HEADERS,
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
  'Cache-Control': 'no-store',
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    if (name === 'Cache-Control' && c.res.headers.has('Cache-Control')) continue;
    c.res.headers.set(name, value);
  }
};
