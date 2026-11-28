import { describe, expect, it } from 'vitest';
import { isSupersededAsset, strategyFor, supersededBy } from '../src/sw/routes.ts';

const ORIGIN = 'https://aplikaacja.example';
const at = (path: string, mode = 'no-cors', method = 'GET') =>
  strategyFor(new URL(path, ORIGIN), ORIGIN, method, mode);

describe('service worker routing (PLAN D11, §4.1)', () => {
  it('caches only public files that are the same for every account', () => {
    expect(at('/assets/main-AbC123_x.js', 'cors')).toBe('shell');
    expect(at('/sym/arasaac/p/2462.0a1b2c3d.webp')).toBe('symbols');
    expect(at('/sym/arasaac/index.963a1920.json', 'cors')).toBe('symbols');
    expect(at('/sym/arasaac/forms.963a1920.json', 'cors')).toBe('symbols');
    expect(at('/sym/arasaac/categories.963a1920.json', 'cors')).toBe('symbols');
    expect(at('/sym/arasaac/grammar.963a1920.json', 'cors')).toBe('symbols');
    expect(at('/tts/runtime/a1b2c3d4/ort-wasm-simd-threaded.wasm', 'cors')).toBe('tts');
    expect(at('/tts/runtime/a1b2c3d4/ort-wasm-simd-threaded.mjs', 'cors')).toBe('tts');
    expect(at('/', 'navigate')).toBe('page');
    expect(at('/prywatnosc?x=1', 'navigate')).toBe('page');
    expect(at('/o-aplikacji', 'navigate')).toBe('page');
    expect(at('/pomoc', 'navigate')).toBe('page');
  });

  it('never touches the API, own photos, the extra set or the login flow', () => {
    for (const path of [
      '/api/me',
      '/api/boards',
      '/api/media/abcdefghijklmnopqrstuvwxyz',
      '/sym/extra/x/1.0a1b2c3d.webp',
      '/sym/extra/index.0a1b2c3d.json',
      '/sym/extra/categories.0a1b2c3d.json',
      '/sym/extra/g/3.0a1b2c3d.webp',
      '/sym/arasaac/manifest.json', // no-cache: it announces new mirror versions
      '/tts/manifest.json', // no-cache: announces runtime/voice hashes
      '/tts/voices/pl_PL-gosia-medium.11223344.onnx.part00', // stored in IndexedDB, not CacheStorage
      '/favicon.svg',
      '/sw.js',
    ]) {
      expect(at(path, 'cors'), path).toBe('network');
    }
    expect(at('/api/auth/login', 'navigate')).toBe('network');
    expect(at('/api/auth/callback?code=x', 'navigate')).toBe('network');
    expect(at('/sym/arasaac/p/1.0a1b2c3d.webp', 'navigate')).toBe('network');
  });

  it('ignores other methods, other origins and odd paths', () => {
    expect(at('/assets/main.js', 'cors', 'POST')).toBe('network');
    expect(strategyFor(new URL('https://evil.example/assets/a.js'), ORIGIN, 'GET', 'cors')).toBe(
      'network',
    );
    expect(at('/sym/arasaac/p/../../api/me.0a1b2c3d.webp')).toBe('network');
    expect(at('/sym/arasaac/p/2462.webp')).toBe('network');
    expect(at('/assets/sub/dir.js', 'cors')).toBe('network');
  });

  it('keeps only the newest mirror index, lexicon, category tree and TTS runtime', () => {
    expect(supersededBy('/sym/arasaac/index.963a1920.json')).toBe('/sym/arasaac/index.');
    expect(supersededBy('/sym/arasaac/forms.963a1920.json')).toBe('/sym/arasaac/forms.');
    expect(supersededBy('/sym/arasaac/categories.963a1920.json')).toBe('/sym/arasaac/categories.');
    expect(supersededBy('/sym/arasaac/grammar.963a1920.json')).toBe('/sym/arasaac/grammar.');
    expect(supersededBy('/sym/arasaac/p/2462.0a1b2c3d.webp')).toBeNull();
    expect(
      isSupersededAsset(
        '/tts/runtime/00001111/ort-wasm-simd-threaded.wasm',
        '/tts/runtime/22223333/ort-wasm-simd-threaded.wasm',
      ),
    ).toBe(true);
    expect(
      isSupersededAsset(
        '/tts/runtime/00001111/ort-wasm-simd-threaded.mjs',
        '/tts/runtime/22223333/ort-wasm-simd-threaded.wasm',
      ),
    ).toBe(false);
  });
});
