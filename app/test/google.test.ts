import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAuthorizationUrl,
  OidcError,
  resetJwksCache,
  verifyIdToken,
} from '../src/worker/auth/google.ts';
import { fakeGoogle, validClaims, type FakeGoogle } from './fake-google.ts';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NONCE = 'nonce-placeholder';

describe('verifyIdToken', () => {
  let g: FakeGoogle;
  beforeEach(async () => {
    resetJwksCache();
    g = await fakeGoogle();
  });

  const verify = (token: string, now = Date.now()) =>
    verifyIdToken(g.fetch, token, { clientId: CLIENT_ID, nonce: NONCE, now });

  it('accepts a valid token and normalises the e-mail', async () => {
    const token = await g.sign(validClaims({ email: 'Parent@Example.COM' }));
    expect(await verify(token)).toEqual({
      sub: '1234567890',
      email: 'parent@example.com',
      name: 'Osoba Testowa',
    });
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['foreign audience', { aud: 'other-client' }],
    ['multi-audience without azp', { aud: [CLIENT_ID, 'other'], azp: 'other' }],
    ['foreign issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['issued in the future', { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ['replayed nonce', { nonce: 'other-nonce' }],
    ['unverified e-mail', { email_verified: false }],
    ['missing sub', { sub: undefined }],
    ['e-mail verified as string', { email_verified: 'true' }],
  ];
  for (const [name, overrides] of rejected) {
    it(`rejects ${name}`, async () => {
      await expect(verify(await g.sign(validClaims(overrides)))).rejects.toBeInstanceOf(OidcError);
    });
  }

  it('rejects alg=none, HS256 and unknown kid', async () => {
    const claims = validClaims();
    await expect(verify(await g.sign(claims, { alg: 'none', kid: g.kid }))).rejects.toBeInstanceOf(
      OidcError,
    );
    await expect(verify(await g.sign(claims, { alg: 'HS256', kid: g.kid }))).rejects.toBeInstanceOf(
      OidcError,
    );
    await expect(
      verify(await g.sign(claims, { alg: 'RS256', kid: 'unknown' })),
    ).rejects.toBeInstanceOf(OidcError);
  });

  it('rejects a payload swapped under a valid signature', async () => {
    const good = (await g.sign(validClaims())).split('.');
    const forged = (await g.sign(validClaims({ sub: 'attacker' }))).split('.');
    await expect(verify(`${good[0]}.${forged[1]}.${good[2]}`)).rejects.toBeInstanceOf(OidcError);
  });

  it('rejects malformed tokens', async () => {
    for (const token of ['', 'a.b', 'a.b.c.d', '!!.??.**']) {
      await expect(verify(token)).rejects.toBeInstanceOf(OidcError);
    }
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests code flow with PKCE S256 and minimal scopes', () => {
    const url = new URL(
      buildAuthorizationUrl({
        clientId: CLIENT_ID,
        redirectUri: 'https://x/cb',
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      state: 's',
      nonce: 'n',
      redirect_uri: 'https://x/cb',
    });
  });
});
