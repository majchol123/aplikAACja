import { z } from 'zod';
import { base64urlDecode, base64urlEncode, utf8 } from '../lib/encoding.ts';
import { randomBytes } from '../lib/crypto.ts';

/**
 * Short-lived, encrypted cookie carrying OAuth `state`, `nonce` and the PKCE verifier
 * between /api/auth/login and /api/auth/callback. Nothing is written to D1 before the
 * user authenticates, so unauthenticated traffic cannot fill the database.
 */
export const OAUTH_COOKIE = '__Host-aplikaacja_oauth';
export const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

const AAD = utf8.encode('aplikaacja-oauth-v1');
const IV_BYTES = 12;

const PayloadSchema = z
  .object({
    state: z.string().min(16).max(128),
    nonce: z.string().min(16).max(128),
    verifier: z.string().min(43).max(128),
    exp: z.number().int(),
  })
  .strict();
export type OAuthPayload = z.infer<typeof PayloadSchema>;

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    const raw = base64urlDecode(secret.trim());
    if (!raw || raw.byteLength !== 32) {
      throw new Error('OAUTH_COOKIE_KEY must be a base64url-encoded 32-byte key');
    }
    key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function sealOAuthPayload(secret: string, payload: OAuthPayload): Promise<string> {
  const key = await importKey(secret);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      utf8.encode(JSON.stringify(payload)),
    ),
  );
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(ciphertext, IV_BYTES);
  return base64urlEncode(out);
}

/** Returns null for anything tampered, malformed or expired. */
export async function openOAuthPayload(
  secret: string,
  sealed: string,
  now: number,
): Promise<OAuthPayload | null> {
  if (sealed.length > 1024) return null;
  const bytes = base64urlDecode(sealed);
  if (!bytes || bytes.byteLength <= IV_BYTES + 16) return null;
  const key = await importKey(secret);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: AAD },
      key,
      bytes.slice(IV_BYTES),
    );
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp <= now) return null;
  return parsed.data;
}
