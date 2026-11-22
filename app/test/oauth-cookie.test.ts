import { describe, expect, it } from 'vitest';
import { openOAuthPayload, sealOAuthPayload } from '../src/worker/auth/oauth-cookie.ts';
import { base64urlDecode, base64urlEncode } from '../src/worker/lib/encoding.ts';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const payload = {
  state: 'state-0123456789abcdef',
  nonce: 'nonce-0123456789abcdef',
  verifier: 'v'.repeat(43),
  exp: 2_000_000_000_000,
};

describe('oauth state cookie', () => {
  it('round-trips', async () => {
    const sealed = await sealOAuthPayload(KEY, payload);
    expect(await openOAuthPayload(KEY, sealed, 1_000)).toEqual(payload);
  });

  it('uses a fresh IV every time', async () => {
    expect(await sealOAuthPayload(KEY, payload)).not.toBe(await sealOAuthPayload(KEY, payload));
  });

  it('rejects tampering, wrong key, expiry and garbage', async () => {
    const sealed = await sealOAuthPayload(KEY, payload);
    const bytes = base64urlDecode(sealed)!;
    bytes[bytes.length - 1]! ^= 1;
    expect(await openOAuthPayload(KEY, base64urlEncode(bytes), 1_000)).toBeNull();
    expect(await openOAuthPayload(OTHER_KEY, sealed, 1_000)).toBeNull();
    expect(await openOAuthPayload(KEY, sealed, payload.exp)).toBeNull();
    expect(await openOAuthPayload(KEY, 'not base64!', 1_000)).toBeNull();
    expect(await openOAuthPayload(KEY, '', 1_000)).toBeNull();
    expect(await openOAuthPayload(KEY, 'A'.repeat(5000), 1_000)).toBeNull();
  });

  it('refuses a key of the wrong length', async () => {
    await expect(sealOAuthPayload('c2hvcnQ', payload)).rejects.toThrow(/32-byte/);
  });
});
