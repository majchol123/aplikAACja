import { z } from 'zod';
import { base64urlDecode, base64urlEncode, utf8 } from '../lib/encoding.ts';
import { sha256, timingSafeEqual } from '../lib/crypto.ts';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_S = 60;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OidcError extends Error {}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64urlEncode(await sha256(verifier));
}

export function buildAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

const TokenResponseSchema = z.object({ id_token: z.string().min(1).max(8192) });

export async function exchangeCode(
  fetchFn: FetchLike,
  params: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
): Promise<string> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.verifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new OidcError(`token endpoint returned ${res.status}`);
  const parsed = TokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new OidcError('token response without id_token');
  return parsed.data.id_token;
}

// --- JWKS cache (per isolate) ------------------------------------------------

const JwkSchema = z.object({
  kid: z.string(),
  kty: z.literal('RSA'),
  n: z.string(),
  e: z.string(),
  alg: z.string().optional(),
  use: z.string().optional(),
});
const JwksSchema = z.object({ keys: z.array(z.unknown()) });

interface JwksCache {
  keys: Map<string, Promise<CryptoKey>>;
  expiresAt: number;
}
let jwksCache: JwksCache | null = null;

/** Test hook: drop cached Google signing keys. */
export function resetJwksCache(): void {
  jwksCache = null;
}

function maxAgeSeconds(cacheControl: string | null): number {
  const m = cacheControl?.match(/max-age=(\d+)/);
  const value = m ? Number(m[1]) : 3600;
  return Math.min(Math.max(value, 60), 24 * 3600);
}

async function loadJwks(fetchFn: FetchLike, now: number): Promise<JwksCache> {
  const res = await fetchFn(GOOGLE_JWKS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new OidcError(`JWKS endpoint returned ${res.status}`);
  const body = JwksSchema.parse(await res.json());
  const keys = new Map<string, Promise<CryptoKey>>();
  for (const raw of body.keys) {
    const jwk = JwkSchema.safeParse(raw);
    if (
      !jwk.success ||
      (jwk.data.alg && jwk.data.alg !== 'RS256') ||
      (jwk.data.use && jwk.data.use !== 'sig')
    ) {
      continue;
    }
    keys.set(
      jwk.data.kid,
      crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.data.n, e: jwk.data.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  return { keys, expiresAt: now + maxAgeSeconds(res.headers.get('Cache-Control')) * 1000 };
}

async function signingKey(fetchFn: FetchLike, kid: string, now: number): Promise<CryptoKey> {
  if (!jwksCache || jwksCache.expiresAt <= now) jwksCache = await loadJwks(fetchFn, now);
  let key = jwksCache.keys.get(kid);
  if (!key) {
    // Key rotation: refresh once before giving up.
    jwksCache = await loadJwks(fetchFn, now);
    key = jwksCache.keys.get(kid);
  }
  if (!key) throw new OidcError('unknown signing key');
  return key;
}

// --- id_token verification ---------------------------------------------------

const HeaderSchema = z.object({ alg: z.literal('RS256'), kid: z.string().min(1).max(128) });
const ClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  azp: z.string().optional(),
  sub: z.string().min(1).max(255),
  exp: z.number(),
  iat: z.number(),
  nonce: z.string(),
  email: z.string().min(3).max(320),
  email_verified: z.boolean(),
  name: z.string().max(200).optional(),
});

function decodeJsonSegment(segment: string): unknown {
  const bytes = base64urlDecode(segment);
  if (!bytes) throw new OidcError('malformed token segment');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OidcError('malformed token segment');
  }
}

export async function verifyIdToken(
  fetchFn: FetchLike,
  idToken: string,
  expected: { clientId: string; nonce: string; now: number },
): Promise<GoogleIdentity> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('malformed token');
  const [h, p, s] = parts as [string, string, string];

  const header = HeaderSchema.safeParse(decodeJsonSegment(h));
  if (!header.success) throw new OidcError('unsupported token header');

  const signature = base64urlDecode(s);
  if (!signature) throw new OidcError('malformed signature');
  const key = await signingKey(fetchFn, header.data.kid, expected.now);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    utf8.encode(`${h}.${p}`),
  );
  if (!valid) throw new OidcError('bad signature');

  const claims = ClaimsSchema.safeParse(decodeJsonSegment(p));
  if (!claims.success) throw new OidcError('missing claims');
  const c = claims.data;
  const nowS = Math.floor(expected.now / 1000);

  if (!GOOGLE_ISSUERS.has(c.iss)) throw new OidcError('bad issuer');
  const audiences = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!audiences.includes(expected.clientId)) throw new OidcError('bad audience');
  if (audiences.length > 1 && c.azp !== expected.clientId)
    throw new OidcError('bad authorized party');
  if (c.exp + CLOCK_SKEW_S < nowS) throw new OidcError('token expired');
  if (c.iat - CLOCK_SKEW_S > nowS) throw new OidcError('token issued in the future');
  if (!timingSafeEqual(c.nonce, expected.nonce)) throw new OidcError('bad nonce');
  if (!c.email_verified) throw new OidcError('email not verified');

  return { sub: c.sub, email: c.email.toLowerCase(), name: c.name?.trim() || null };
}
