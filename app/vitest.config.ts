import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
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
