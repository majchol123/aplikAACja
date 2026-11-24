import { describe, expect, it } from 'vitest';
import { extraFile } from '../src/worker/symbols/extra-gate.ts';
import { insertUser, makeApp, ORIGIN, sessionCookie } from './helpers.ts';

/** The fake upstream (vitest.config.ts) serves manifest.json and x/1.0000abcd.webp only. */
describe('/sym/extra/* gate', () => {
  const { call } = makeApp();

  async function extraUser(): Promise<string> {
    return sessionCookie((await insertUser({ extraSet: true })).id);
  }

  it('requires a session and the per-account flag', async () => {
    expect((await call('/sym/extra/manifest.json')).status).toBe(401);
    const plain = await sessionCookie((await insertUser()).id);
    const denied = await call('/sym/extra/manifest.json', { headers: { Cookie: plain } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'extra_set_not_enabled' });
    // Refused before the file name is even looked at.
    const probe = await call('/sym/extra/nope', { headers: { Cookie: plain } });
    expect(probe.status).toBe(403);
  });

  it('serves the manifest privately, without forwarding client headers', async () => {
    const cookie = await extraUser();
    const res = await call('/sym/extra/manifest.json', {
      headers: { Cookie: cookie, Authorization: 'Bearer x', 'X-Forwarded-For': '1.2.3.4' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('Set-Cookie')).toBeNull(); // upstream cookie dropped
    const seen = (await res.json()) as { url: string; headers: Record<string, string> };
    expect(seen.url).toBe('https://aplikaacja-extra.internal/manifest.json');
    expect(Object.keys(seen.headers)).not.toEqual(
      expect.arrayContaining(['cookie', 'authorization', 'x-forwarded-for']),
    );
  });

  it('serves images as immutable WebP whatever the upstream claims', async () => {
    const res = await call('/sym/extra/x/1.0000abcd.webp', {
      headers: { Cookie: await extraUser() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('ETag')).toBe('"extra-v1"');
  });

  it('passes revalidation through (304)', async () => {
    const res = await call('/sym/extra/manifest.json', {
      headers: { Cookie: await extraUser(), 'If-None-Match': '"extra-v1"' },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('answers 404 for well-formed names the set does not have', async () => {
    const res = await call('/sym/extra/x/2.0000abcd.webp', {
      headers: { Cookie: await extraUser() },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects traversal, encoding tricks and unknown names (PLAN §7)', async () => {
    const cookie = await extraUser();
    const attempts = [
      '/sym/extra/',
      '/sym/extra/index.json',
      '/sym/extra/MANIFEST.JSON',
      '/sym/extra/manifest.json/',
      '/sym/extra/manifest.json%00',
      '/sym/extra/manifest%2ejson',
      '/sym/extra/x/1.0000ABCD.webp',
      '/sym/extra/x/1.0000abcd.webp.html',
      '/sym/extra/x/-1.0000abcd.webp',
      '/sym/extra/x%2f1.0000abcd.webp',
      '/sym/extra/x%2F1.0000abcd.webp',
      '/sym/extra/x%5c1.0000abcd.webp',
      '/sym/extra/..%2fmanifest.json',
      '/sym/extra/..%2f..%2fapi%2fme',
      '/sym/extra/%2e%2e/api/me',
      '/sym/extra/%252e%252e/manifest.json',
      '/sym/extra/x/../../api/me',
      '/sym/extra/x/１.0000abcd.webp', // fullwidth digit one
      '/sym/extra/x//1.0000abcd.webp',
      '/sym/extra/./manifest.json.bak',
    ];
    for (const path of attempts) {
      const res = await call(path, { headers: { Cookie: cookie } });
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain('extra.internal');
    }
    // The URL parser resolves dot segments (also %2e%2e) before routing, exactly like
    // browsers do: these stay inside /sym/extra/ and the query string is never used.
    for (const path of [
      '/sym/extra/x/%2e%2e/manifest.json',
      '/sym/extra/x/../manifest.json',
      '/sym/extra/manifest.json?file=../../secret',
    ]) {
      const res = await call(path, { headers: { Cookie: cookie } });
      expect(res.status, path).toBe(200);
      const seen = (await res.json()) as { url: string };
      expect(seen.url, path).toBe('https://aplikaacja-extra.internal/manifest.json');
    }
  });

  it('validates the raw pathname', () => {
    expect(extraFile(`${ORIGIN}/sym/extra/manifest.json`)).toBe('manifest.json');
    expect(extraFile(`${ORIGIN}/sym/extra/forms.0123abcd.json`)).toBe('forms.0123abcd.json');
    expect(extraFile(`${ORIGIN}/sym/extra/grammar.0123abcd.json`)).toBe('grammar.0123abcd.json');
    expect(extraFile(`${ORIGIN}/sym/extra/index.0123abcd.json`)).toBe('index.0123abcd.json');
    expect(extraFile(`${ORIGIN}/sym/extra/x/15028.0123abcd.webp`)).toBe('x/15028.0123abcd.webp');
    expect(extraFile(`${ORIGIN}/sym/extra/categories.0123abcd.json`)).toBe(
      'categories.0123abcd.json',
    );
    expect(extraFile(`${ORIGIN}/sym/extra/g/3.0123abcd.webp`)).toBe('g/3.0123abcd.webp');
    expect(extraFile(`${ORIGIN}/sym/extra/g/3.0123abcd.json`)).toBeNull();
    expect(extraFile(`${ORIGIN}/sym/extra/categories.json`)).toBeNull();
    expect(extraFile(`${ORIGIN}/sym/extra/p/1.0123abcd.webp`)).toBeNull();
    expect(extraFile(`${ORIGIN}/sym/arasaac/manifest.json`)).toBeNull();
  });

  it('answers 503 when the private Worker is missing or failing', async () => {
    const cookie = await extraUser();
    const missing = await call(
      '/sym/extra/manifest.json',
      { headers: { Cookie: cookie } },
      { EXTRA_SET: undefined },
    );
    expect(missing.status).toBe(503);
    const failing = await call(
      '/sym/extra/manifest.json',
      { headers: { Cookie: cookie } },
      {
        EXTRA_SET: {
          fetch: () => Promise.reject(new Error('down')),
          connect: () => {
            throw new Error('unused');
          },
        },
      },
    );
    expect(failing.status).toBe(503);
    expect(await failing.json()).toEqual({ error: 'extra_set_unavailable' });
  });

  it('rejects a duplicated session cookie', async () => {
    const cookie = await extraUser();
    const res = await call('/sym/extra/manifest.json', {
      headers: { Cookie: `${cookie}; ${cookie}` },
    });
    expect(res.status).toBe(400);
  });

  it('is read-only', async () => {
    const res = await call('/sym/extra/manifest.json', {
      method: 'POST',
      headers: { Cookie: await extraUser() },
    });
    expect(res.status).toBe(404);
  });
});
