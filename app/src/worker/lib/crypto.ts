import { base32Encode, base64urlEncode, hexEncode, utf8 } from './encoding.ts';

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Random 128-bit identifier, lowercase base32 (26 chars). Not guessable, not sequential. */
export function newId(): string {
  return base32Encode(randomBytes(16));
}

/** Random 256-bit URL-safe token. */
export function newToken(): string {
  return base64urlEncode(randomBytes(32));
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? utf8.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return hexEncode(await sha256(data));
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = utf8.encode(a);
  const bb = utf8.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
