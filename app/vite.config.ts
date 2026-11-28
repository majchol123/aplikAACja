import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
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
    // Browsers check the worker script for updates themselves; it must never be stale.
    '/sw.js',
    block({ 'Cache-Control': 'no-cache' }),
    '',
  ].join('\n');
  return {
    name: 'aplikaacja:static-headers',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source });
    },
  };
}

/**
 * The service worker is built as its own entry at /sw.js (its scope is the whole origin).
 * It is registered as a classic script, so it must not import shared chunks.
 */
function serviceWorkerEntry(): Plugin {
  return {
    name: 'aplikaacja:service-worker',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    generateBundle(_options, bundle) {
      const sw = bundle['sw.js'];
      if (!sw || sw.type !== 'chunk') throw new Error('sw.js was not emitted');
      if (sw.imports.length > 0 || sw.dynamicImports.length > 0) {
        throw new Error(`sw.js must be self-contained, imports: ${sw.imports.join(', ')}`);
      }
    },
  };
}

const CONTACT_PLACEHOLDER = /%APLIKAACJA_CONTACT_EMAIL%/g;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * The operator's contact address is published on /prywatnosc but kept out of the
 * repository and the public Actions logs: deploy builds take it from CONTACT_EMAIL, a GitHub
 * environment secret (masked in logs, unlike `vars`).
 */
function contactEmail(): Plugin {
  const deployEnv = process.env.CLOUDFLARE_ENV;
  const value = process.env.CONTACT_EMAIL?.trim();
  if (value && !EMAIL_RE.test(value)) throw new Error('CONTACT_EMAIL is not a valid address');
  if (deployEnv && !value) throw new Error(`CONTACT_EMAIL is required for ${deployEnv} builds`);
  const email = value ?? 'kontakt@example.invalid';
  return {
    name: 'aplikaacja:contact-email',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(CONTACT_PLACEHOLDER, email),
    },
  };
}

const TTS_MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** Serves locally built `/tts/*` assets (workers/tts/dist/tts) during `vite dev` and `vite preview`. */
function localTtsAssets(): Plugin {
  const ttsRoot = resolve(import.meta.dirname, '../workers/tts/dist/tts');
  const attach = (middlewares: {
    use: (
      path: string,
      fn: (
        req: { url?: string; method?: string },
        res: {
          statusCode: number;
          setHeader: (name: string, val: string) => void;
          end: (body?: string) => void;
        } & NodeJS.WritableStream,
        next: () => void,
      ) => void,
    ) => void;
  }) => {
    middlewares.use('/tts', (req, res, next) => {
      if (req.method !== 'GET' || !req.url) return next();
      const rel = req.url.split('?')[0]?.replace(/^\/+/, '') ?? '';
      const filePath = resolve(ttsRoot, rel);
      if (filePath !== ttsRoot && !filePath.startsWith(ttsRoot + sep)) return next();
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();
      res.setHeader('Content-Type', TTS_MIME[extname(filePath)] ?? 'application/octet-stream');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      createReadStream(filePath).pipe(res);
    });
  };
  return {
    name: 'aplikaacja:local-tts',
    configureServer: (server) => attach(server.middlewares),
    configurePreviewServer: (server) => attach(server.middlewares),
  };
}

/** Uses `ort.wasm.min.mjs` so Vite does not duplicate the 15 MB .wasm file already served under `/tts/`. */
function externOrtWasm(): Plugin {
  const require = createRequire(import.meta.url);
  const externEntry = resolve(dirname(require.resolve('onnxruntime-web/wasm')), 'ort.wasm.min.mjs');
  return {
    name: 'aplikaacja:extern-ort-wasm',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'onnxruntime-web/wasm') return externEntry;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    externOrtWasm(),
    localTtsAssets(),
    react(),
    tailwindcss(),
    cloudflare(),
    staticHeaders(),
    serviceWorkerEntry(),
    contactEmail(),
  ],
  worker: {
    format: 'es',
    plugins: () => [externOrtWasm()],
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            privacy: resolve(import.meta.dirname, 'prywatnosc.html'),
            about: resolve(import.meta.dirname, 'o-aplikacji.html'),
            help: resolve(import.meta.dirname, 'pomoc.html'),
            sw: resolve(import.meta.dirname, 'src/sw/sw.ts'),
          },
          output: {
            entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
          },
        },
      },
    },
  },
});
