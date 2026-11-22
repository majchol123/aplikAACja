import { describe, expect, it } from 'vitest';
import { makeApp, setCookies, writeHeaders } from './helpers.ts';

const body = JSON.stringify({ sub: 'e2e', email: 'e2e@example.com', name: 'E2E' });

describe('dev login (E2E only)', () => {
  it('works only with DEV_AUTH=1 on localhost', async () => {
    const t = makeApp();
    const res = await t.call(
      '/api/auth/dev-login',
      { method: 'POST', headers: writeHeaders(), body },
      { DEV_AUTH: '1' },
    );
    expect(res.status).toBe(204);
    const sid = setCookies(res)['__Host-relaacja_sid']!.value;
    expect(
      (await t.call('/api/me', { headers: { Cookie: `__Host-relaacja_sid=${sid}` } })).status,
    ).toBe(200);
  });

  it('is a 404 when DEV_AUTH is set on a non-localhost deployment', async () => {
    const t = makeApp();
    const prod = 'https://relaacja.jagiellona.one.pl';
    const res = await t.call(
      `${prod}/api/auth/dev-login`,
      { method: 'POST', headers: { ...writeHeaders(), Origin: prod }, body },
      { DEV_AUTH: '1', APP_ORIGIN: prod },
    );
    expect(res.status).toBe(404);
  });

  it('is a 404 when the request host is not localhost even if APP_ORIGIN is', async () => {
    const t = makeApp();
    const res = await t.call(
      'https://relaacja.jagiellona.one.pl/api/auth/dev-login',
      { method: 'POST', headers: writeHeaders(), body },
      { DEV_AUTH: '1' },
    );
    expect(res.status).toBe(404);
  });
});
