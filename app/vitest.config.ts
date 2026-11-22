import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Stand-in for the private extra-set Worker. manifest.json echoes what the gate forwarded,
 * so tests can check that no client headers (cookies) leak to the upstream Worker.
 */
function fakeExtraSet(request: Request): Response {
  const path = new URL(request.url).pathname;
  const etag = '"extra-v1"';
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304 });
  if (path === '/manifest.json') {
    const seen = { url: request.url, headers: Object.fromEntries(request.headers) };
    return Response.json(seen, { headers: { ETag: etag, 'Set-Cookie': 'upstream=1' } });
  }
  if (path === '/x/1.0000abcd.webp') {
    return new Response('RIFF\0\0\0\0WEBP', {
      headers: { 'Content-Type': 'text/html', ETag: etag },
    });
  }
  return new Response('missing', { status: 404 });
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          serviceBindings: { EXTRA_SET: fakeExtraSet },
          bindings: {
            TEST_MIGRATIONS: migrations,
            GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
            GOOGLE_CLIENT_SECRET: 'test-secret',
            // 32 zero bytes, base64url — test-only key.
            OAUTH_COOKIE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            ADMIN_EMAILS: 'root@example.com\nsecond@example.com',
            // Explicit values override a developer's local .dev.vars (which may enable DEV_AUTH).
            DEV_AUTH: '0',
          },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
