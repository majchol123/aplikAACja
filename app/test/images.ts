/**
 * Minimal image files built byte by byte: correct structure (signatures, chunk and segment
 * lengths, dimensions), dummy pixel data. Enough for the server, which never decodes
 * pixels; real pictures are exercised by the E2E suite.
 */
const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

/** What a phone camera puts into its pictures (and the server must not keep). */
export const GPS_EXIF = ascii('Exif\0\0MM\0*GPSLatitude=52.2297N GPSLongitude=21.0122E');

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0]; // CRC not checked
}

export function png(width: number, height: number, opts: { metadata?: boolean } = {}) {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]),
    ...(opts.metadata
      ? [...pngChunk('eXIf', GPS_EXIF), ...pngChunk('tEXt', ascii('Author\0Jan Kowalski'))]
      : []),
    ...pngChunk('IDAT', [0x78, 0x9c, 1, 2, 3, 4]),
    ...pngChunk('IEND', []),
    ...(opts.metadata ? ascii('trailing bytes after the end') : []),
  ]);
}

function jpegSegment(marker: number, data: number[]): number[] {
  return [0xff, marker, ...u16be(data.length + 2), ...data];
}

export function jpeg(width: number, height: number, opts: { metadata?: boolean } = {}) {
  return new Uint8Array([
    0xff,
    0xd8,
    ...jpegSegment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(opts.metadata
      ? [...jpegSegment(0xe1, GPS_EXIF), ...jpegSegment(0xfe, ascii('Jan Kowalski'))]
      : []),
    ...jpegSegment(0xdb, [0, ...new Array<number>(64).fill(1)]),
    ...jpegSegment(0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]),
    ...jpegSegment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0xff,
    0x00,
    0x56, // entropy-coded data with a stuffed 0xFF
    0xff,
    0xd9,
    ...(opts.metadata ? ascii('trailing bytes after the end') : []),
  ]);
}

function riffChunk(fourcc: string, data: number[]): number[] {
  return [...ascii(fourcc), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
}

function riff(chunks: number[]): Uint8Array {
  return new Uint8Array([
    ...ascii('RIFF'),
    ...u32le(4 + chunks.length),
    ...ascii('WEBP'),
    ...chunks,
  ]);
}

/** Lossy WebP; with metadata in the extended format (VP8X + EXIF + XMP chunks). */
export function webp(
  width: number,
  height: number,
  opts: { metadata?: boolean; animated?: boolean } = {},
) {
  const frame = riffChunk('VP8 ', [
    0x30,
    0x01,
    0x00,
    0x9d,
    0x01,
    0x2a,
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
    1,
    2,
    3,
  ]);
  if (!opts.metadata && !opts.animated) return riff(frame);
  const flags = (opts.metadata ? 0x08 | 0x04 : 0) | (opts.animated ? 0x02 : 0);
  return riff([
    ...riffChunk('VP8X', [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]),
    ...frame,
    ...(opts.metadata
      ? [...riffChunk('EXIF', GPS_EXIF), ...riffChunk('XMP ', ascii('<x:xmpmeta/>'))]
      : []),
  ]);
}

/** Lossless WebP (simple format). */
export function webpLossless(width: number, height: number) {
  const bits = (width - 1) | ((height - 1) << 14);
  return riff(riffChunk('VP8L', [0x2f, ...u32le(bits), 0, 0, 0]));
}

export function contains(haystack: Uint8Array, needle: string): boolean {
  const bytes = ascii(needle);
  outer: for (let i = 0; i + bytes.length <= haystack.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (haystack[i + j] !== bytes[j]) continue outer;
    return true;
  }
  return false;
}
