import { MEDIA_LIMITS, type MediaType } from '@relaacja/shared';

/**
 * Server-side check of an uploaded own photo (PLAN §4.1 "malicious upload"). The type is
 * decided by the file signature, never by the client; dimensions come from the header;
 * metadata (EXIF with GPS, XMP, IPTC, comments, text chunks) is dropped even though the
 * browser re-encodes every photo, so the guarantee does not depend on the client. Pixel
 * data is not decoded: the picture is only ever served back as an image, with nosniff and
 * a sandboxing CSP, to the account that uploaded it.
 */
export type ImageProblem = 'unsupported_type' | 'invalid_image' | 'too_large';

export interface CleanImage {
  mime: MediaType;
  width: number;
  height: number;
  data: Uint8Array;
}

type Result = CleanImage | { error: ImageProblem };

class Invalid extends Error {
  constructor(readonly problem: ImageProblem = 'invalid_image') {
    super(problem);
  }
}

class Reader {
  constructor(readonly b: Uint8Array) {}
  need(offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset + length > this.b.length) throw new Invalid();
  }
  u8(o: number): number {
    const v = this.b[o];
    if (v === undefined) throw new Invalid();
    return v;
  }
  u16be(o: number): number {
    return (this.u8(o) << 8) | this.u8(o + 1);
  }
  u16le(o: number): number {
    return this.u8(o) | (this.u8(o + 1) << 8);
  }
  u24le(o: number): number {
    return this.u8(o) | (this.u8(o + 1) << 8) | (this.u8(o + 2) << 16);
  }
  u32be(o: number): number {
    return this.u8(o) * 2 ** 24 + ((this.u8(o + 1) << 16) | (this.u8(o + 2) << 8) | this.u8(o + 3));
  }
  u32le(o: number): number {
    return this.u8(o) + (this.u8(o + 1) << 8) + (this.u8(o + 2) << 16) + this.u8(o + 3) * 2 ** 24;
  }
  ascii(o: number, n: number): string {
    this.need(o, n);
    return String.fromCharCode(...this.b.subarray(o, o + n));
  }
  starts(bytes: readonly number[]): boolean {
    return this.b.length >= bytes.length && bytes.every((v, i) => this.b[i] === v);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- PNG -------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function png(r: Reader): Omit<CleanImage, 'mime'> {
  const kept: Uint8Array[] = [r.b.subarray(0, 8)];
  let p = 8;
  let width = 0;
  let height = 0;
  let pixels = false;
  for (let index = 0; ; index++) {
    const length = r.u32be(p);
    const type = r.ascii(p + 4, 4);
    const end = p + 12 + length;
    r.need(p, 12 + length);
    if (index === 0) {
      if (type !== 'IHDR' || length !== 13) throw new Invalid();
      width = r.u32be(p + 8);
      height = r.u32be(p + 12);
    }
    if (type === 'acTL') throw new Invalid('unsupported_type'); // animated PNG
    if (type === 'IDAT') pixels = true;
    if (!PNG_DROPPED.has(type)) kept.push(r.b.subarray(p, end));
    p = end;
    if (type === 'IEND') break; // anything after the end is dropped too
  }
  if (!pixels) throw new Invalid();
  return { width, height, data: concat(kept) };
}

// --- JPEG ------------------------------------------------------------------------------

/** APP0 (JFIF), APP2 (ICC profile) and APP14 (Adobe colour transform) are needed to show
 * the picture correctly; every other APPn segment and comments are metadata. */
const JPEG_KEPT_APP = new Set([0xe0, 0xe2, 0xee]);

function jpeg(r: Reader): Omit<CleanImage, 'mime'> {
  const kept: Uint8Array[] = [r.b.subarray(0, 2)];
  let p = 2;
  let width = 0;
  let height = 0;
  for (;;) {
    if (r.u8(p) !== 0xff) throw new Invalid();
    let marker = r.u8(p + 1);
    while (marker === 0xff) {
      p++; // fill bytes
      marker = r.u8(p + 1);
    }
    if (marker === 0xd8 || marker === 0xd9) throw new Invalid(); // SOI again, or EOI before SOS
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(r.b.subarray(p, p + 2));
      p += 2;
      continue;
    }
    const length = r.u16be(p + 2);
    if (length < 2) throw new Invalid();
    const end = p + 2 + length;
    r.need(p, 2 + length);
    if (marker === 0xda) {
      // Start of scan: entropy-coded data up to the last end-of-image marker, kept as is.
      let eoi = -1;
      for (let i = r.b.length - 2; i >= end; i--) {
        if (r.b[i] === 0xff && r.b[i + 1] === 0xd9) {
          eoi = i;
          break;
        }
      }
      if (eoi < 0 || width === 0) throw new Invalid();
      kept.push(r.b.subarray(p, eoi + 2));
      break;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      height = r.u16be(p + 5);
      width = r.u16be(p + 7);
    }
    const metadata =
      (marker >= 0xe0 && marker <= 0xef && !JPEG_KEPT_APP.has(marker)) || marker === 0xfe;
    if (!metadata) kept.push(r.b.subarray(p, end));
    p = end;
  }
  return { width, height, data: concat(kept) };
}

// --- WebP ------------------------------------------------------------------------------

const VP8X_ANIMATION = 0x02;
const VP8X_XMP = 0x04;
const VP8X_EXIF = 0x08;

function webp(r: Reader): Omit<CleanImage, 'mime'> {
  const riffEnd = 8 + r.u32le(4);
  r.need(0, riffEnd);
  const chunks: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let pixels = false;
  for (let p = 12, index = 0; p < riffEnd; index++) {
    const fourcc = r.ascii(p, 4);
    const size = r.u32le(p + 4);
    const padded = size + (size & 1);
    r.need(p, 8 + padded);
    if (p + 8 + padded > riffEnd) throw new Invalid();
    const data = p + 8;
    if (index === 0 && !['VP8 ', 'VP8L', 'VP8X'].includes(fourcc)) throw new Invalid();
    if (fourcc === 'ANIM' || fourcc === 'ANMF') throw new Invalid('unsupported_type');
    if (fourcc === 'VP8X') {
      if (index !== 0 || size < 10) throw new Invalid();
      if (r.u8(data) & VP8X_ANIMATION) throw new Invalid('unsupported_type');
      width = 1 + r.u24le(data + 4);
      height = 1 + r.u24le(data + 7);
      const copy = r.b.slice(p, p + 8 + padded);
      copy[8] = r.u8(data) & ~(VP8X_EXIF | VP8X_XMP);
      chunks.push(copy);
    } else {
      if (fourcc === 'VP8 ') {
        if (r.u8(data + 3) !== 0x9d || r.u8(data + 4) !== 0x01 || r.u8(data + 5) !== 0x2a) {
          throw new Invalid();
        }
        if (index === 0) {
          width = r.u16le(data + 6) & 0x3fff;
          height = r.u16le(data + 8) & 0x3fff;
        }
        pixels = true;
      } else if (fourcc === 'VP8L') {
        if (r.u8(data) !== 0x2f) throw new Invalid();
        if (index === 0) {
          const bits = r.u32le(data + 1);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
        pixels = true;
      }
      if (fourcc !== 'EXIF' && fourcc !== 'XMP ') chunks.push(r.b.subarray(p, p + 8 + padded));
    }
    p += 8 + padded;
  }
  if (!pixels) throw new Invalid();
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return { width, height, data: concat([header, body]) };
}

// ---------------------------------------------------------------------------------------

export function cleanImage(input: Uint8Array): Result {
  if (input.length > MEDIA_LIMITS.maxFileBytes) return { error: 'too_large' };
  const r = new Reader(input);
  let mime: MediaType;
  let parse: (r: Reader) => Omit<CleanImage, 'mime'>;
  if (r.starts(PNG_SIGNATURE)) {
    mime = 'image/png';
    parse = png;
  } else if (r.starts([0xff, 0xd8, 0xff])) {
    mime = 'image/jpeg';
    parse = jpeg;
  } else if (r.starts([0x52, 0x49, 0x46, 0x46]) && r.b.length >= 12 && r.ascii(8, 4) === 'WEBP') {
    mime = 'image/webp';
    parse = webp;
  } else {
    // SVG, GIF, HEIC, HTML, … — whatever the client called it.
    return { error: 'unsupported_type' };
  }
  try {
    const image = parse(r);
    if (image.width < 1 || image.height < 1) return { error: 'invalid_image' };
    if (image.width > MEDIA_LIMITS.maxSide || image.height > MEDIA_LIMITS.maxSide) {
      return { error: 'too_large' };
    }
    return { mime, ...image };
  } catch (err) {
    if (err instanceof Invalid) return { error: err.problem };
    throw err;
  }
}
