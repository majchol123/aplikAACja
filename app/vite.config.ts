import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { COMMON_SECURITY_HEADERS, HTML_CSP } from './src/worker/security/headers.ts';

/**
 * Static assets are served without invoking the Worker (free, unmetered), so their
 * security headers come from a `_headers` file. Emitted at build time only: the dev
 * server needs inline scripts/styles for HMR, which this CSP forbids.
 */
function staticHeaders(): Plugin {
  const block = (headers: Record<string, string>) =>
    Object.entries(headers)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
  const source = [
    '/*',
    block({ ...COMMON_SECURITY_HEADERS, 'Content-Security-Policy': HTML_CSP }),
    '/assets/*',
    block({ 'Cache-Control': 'public, max-age=31536000, immutable' }),
    '',
  ].join('\n');
  return {
    name: 'relaacja:static-headers',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(), staticHeaders()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            privacy: resolve(import.meta.dirname, 'prywatnosc.html'),
          },
        },
      },
    },
  },
});
