import { MEDIA_LIMITS } from '@relaacja/shared';

/** Shown to the user as is. */
export class PhotoError extends Error {}

/** Square part of the source picture, in source pixels. */
export interface Crop {
  x: number;
  y: number;
  size: number;
}

/** The largest centred square: the starting point of the crop. */
export function fullCrop(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/** Zoom 1 = the whole shorter side; up to 4×, never below 64 source pixels. */
export function maxZoom(width: number, height: number): number {
  return Math.max(1, Math.min(4, Math.min(width, height) / 64));
}

/** Keeps the square inside the picture and the zoom within its range. */
export function clampCrop(crop: Crop, width: number, height: number): Crop {
  const full = Math.min(width, height);
  const size = Math.min(full, Math.max(full / maxZoom(width, height), crop.size));
  return {
    x: Math.min(Math.max(crop.x, 0), width - size),
    y: Math.min(Math.max(crop.y, 0), height - size),
    size,
  };
}

/** Same centre, another zoom. */
export function zoomCrop(crop: Crop, zoom: number, width: number, height: number): Crop {
  const size = Math.min(width, height) / zoom;
  const cx = crop.x + crop.size / 2;
  const cy = crop.y + crop.size / 2;
  return clampCrop({ x: cx - size / 2, y: cy - size / 2, size }, width, height);
}

/** Longest side of the working copy: a 12 MP phone photo fits as is. */
const WORK_MAX = 4096;

/**
 * Decodes a picked file of any size with its EXIF orientation applied. Nothing of the
 * original file (EXIF with GPS, other metadata) survives: only pixels are drawn and
 * re-encoded. Huge originals (panoramas, 50 MP cameras) are reduced to a working copy
 * right away, so cropping stays within the memory of a tablet.
 */
export async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(
      'Nie udało się otworzyć tego pliku. Wybierz zdjęcie JPEG, PNG lub WebP (zdjęcie HEIC z iPhone’a najpierw zapisz jako JPEG).',
    );
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= WORK_MAX) return bitmap;
  const scale = WORK_MAX / longest;
  try {
    const copy = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      resizeQuality: 'high',
    });
    bitmap.close();
    return copy;
  } catch {
    return bitmap; // no resizing in this browser: crop the original
  }
}

function draw(source: CanvasImageSource, from: Crop, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new PhotoError('Ta przeglądarka nie potrafi przygotować zdjęcia.');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, from.x, from.y, from.size, from.size, 0, 0, size, size);
  return canvas;
}

/** Biggest intermediate canvas (memory limits of mobile Safari). */
const STEP_MAX = 2048;

/**
 * The crop scaled to at most `out` pixels (never enlarged), halving step by step: one big
 * downscale aliases badly in some browsers.
 */
export function renderCrop(source: CanvasImageSource, crop: Crop, out: number): HTMLCanvasElement {
  const final = Math.max(1, Math.min(out, Math.round(crop.size)));
  const largest = Math.min(Math.round(crop.size), STEP_MAX);
  let size = final;
  while (size * 2 <= largest) size *= 2; // final × 2^k: every later step halves exactly
  let canvas = draw(source, crop, size);
  while (size > final) {
    canvas = draw(canvas, { x: 0, y: 0, size }, size / 2);
    size /= 2;
  }
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The same picture on white: JPEG has no transparency. */
function onWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const g = flat.getContext('2d');
  if (!g) throw new PhotoError('Ta przeglądarka nie potrafi przygotować zdjęcia.');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  return flat;
}

/**
 * WebP where the browser can encode it; Safari cannot (it silently returns PNG), so JPEG
 * there. Lower quality, and as a last resort fewer pixels, only if the picture would not
 * fit the upload limit (very detailed photos: foliage, gravel, noise).
 */
export async function encodePhoto(canvas: HTMLCanvasElement): Promise<Blob> {
  let flat: HTMLCanvasElement | null = null;
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (blob?.type !== 'image/webp') {
      flat ??= onWhite(canvas);
      blob = await toBlob(flat, 'image/jpeg', quality);
    }
    if (blob && blob.size <= MEDIA_LIMITS.maxFileBytes) return blob;
  }
  if (canvas.width > 128) {
    const smaller = Math.round(canvas.width * 0.75);
    return encodePhoto(draw(canvas, { x: 0, y: 0, size: canvas.width }, smaller));
  }
  throw new PhotoError('Nie udało się przygotować zdjęcia. Spróbuj z innym plikiem.');
}
