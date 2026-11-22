import { describe, expect, it } from 'vitest';
import { insertUser, makeApp, ORIGIN, sessionCookie, writeHeaders } from './helpers.ts';

describe('CSRF guard (one.pl is not on the PSL, PLAN §4.1)', () => {
  const patch = async (headers: Record<string, string>, body = '{"returnToHome":false}') => {
    const t = makeApp();
    const user = await insertUser();
    const cookie = await sessionCookie(user.id);
    return t.call('/api/settings', {
      method: 'PATCH',
      headers: { ...headers, Cookie: cookie },
      body,
    });
  };

  it('accepts a genuine same-origin request', async () => {
    expect((await patch(writeHeaders())).status).toBe(200);
  });

  const attacks: [string, Record<string, string>][] = [
    ['missing Origin', { ...writeHeaders(), Origin: '' }],
    ['sibling *.one.pl origin', { ...writeHeaders(), Origin: 'https://evil.one.pl' }],
    [
      'sibling host in the same zone',
      { ...writeHeaders(), Origin: 'https://other.jagiellona.one.pl' },
    ],
    ['origin prefix trick', { ...writeHeaders(), Origin: `${ORIGIN}.evil.one.pl` }],
    ['same-site fetch', { ...writeHeaders(), 'Sec-Fetch-Site': 'same-site' }],
    ['cross-site fetch', { ...writeHeaders(), 'Sec-Fetch-Site': 'cross-site' }],
    [
      'missing custom header',
      { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    ],
    [
      'form content type',
      { ...writeHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
    ],
    ['text/plain content type', { ...writeHeaders(), 'Content-Type': 'text/plain' }],
  ];
  for (const [name, headers] of attacks) {
    it(`rejects ${name}`, async () => {
      const res = await patch(
        Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== '')),
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'csrf' });
    });
  }

  it('tolerates browsers that do not send Sec-Fetch-Site (old iPads) when the rest matches', async () => {
    const headers = writeHeaders();
    delete headers['Sec-Fetch-Site'];
    expect((await patch(headers)).status).toBe(200);
  });
});

describe('API response headers', () => {
  it('are hardened and never cached', async () => {
    const t = makeApp();
    for (const path of ['/api/health', '/api/me', '/api/does-not-exist']) {
      const res = await t.call(path);
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('unknown API routes return a uniform JSON 404', async () => {
    const t = makeApp();
    for (const path of [
      '/api/nope',
      '/api/boards/../../admin',
      '/api/%2e%2e/admin/users',
      '/api/admin/users/x',
    ]) {
      const res = await t.call(path);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });
});
