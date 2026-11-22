import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, type FetchLike } from '../src/worker/auth/google.ts';
import { base64urlEncode, utf8 } from '../src/worker/lib/encoding.ts';

export interface FakeGoogle {
  fetch: FetchLike;
  sign: (claims: Record<string, unknown>, header?: Record<string, unknown>) => Promise<string>;
  /** id_token the token endpoint returns for the next code exchange. */
  nextIdToken: string | null;
  tokenRequests: URLSearchParams[];
  kid: string;
}

export async function fakeGoogle(): Promise<FakeGoogle> {
  const kid = 'test-key-1';
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;

  const fake: FakeGoogle = {
    kid,
    nextIdToken: null,
    tokenRequests: [],
    async sign(claims, header = { alg: 'RS256', kid, typ: 'JWT' }) {
      const h = base64urlEncode(utf8.encode(JSON.stringify(header)));
      const p = base64urlEncode(utf8.encode(JSON.stringify(claims)));
      const sig = new Uint8Array(
        await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, utf8.encode(`${h}.${p}`)),
      );
      return `${h}.${p}.${base64urlEncode(sig)}`;
    },
    async fetch(input, init) {
      if (input === GOOGLE_JWKS_URL) {
        return Response.json(
          { keys: [{ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: publicJwk.n, e: publicJwk.e }] },
          { headers: { 'Cache-Control': 'public, max-age=3600' } },
        );
      }
      if (input === GOOGLE_TOKEN_URL && init?.method === 'POST') {
        fake.tokenRequests.push(new URLSearchParams(String(init.body)));
        if (!fake.nextIdToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({
          id_token: fake.nextIdToken,
          access_token: 'unused',
          token_type: 'Bearer',
        });
      }
      throw new Error(`unexpected outbound fetch: ${input}`);
    },
  };
  return fake;
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: 'test-client.apps.googleusercontent.com',
    azp: 'test-client.apps.googleusercontent.com',
    sub: '1234567890',
    email: 'parent@example.com',
    email_verified: true,
    name: 'Rodzic Testowy',
    iat: now,
    exp: now + 3600,
    nonce: 'nonce-placeholder',
    ...overrides,
  };
}
