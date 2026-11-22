import { z } from 'zod';
import { TileLabelSchema, type BoardChanges } from './boards.ts';
import { tokenize } from './normalize.ts';

/**
 * Own photos (PLAN §2.2, §3.5): pictures of one account, stored in its vault and shown
 * only to it. The browser crops and re-encodes every photo before upload; the server
 * accepts only still WebP/JPEG/PNG within these limits and drops metadata segments.
 */
export const MEDIA_LIMITS = {
  /** One stored picture, after the browser scaled it to maxSide (typically 30–80 KB). */
  maxFileBytes: 200 * 1024,
  /** Longest side in pixels. */
  maxSide: 512,
  maxCount: 2000,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;

export const MEDIA_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Name of a photo: searched like a symbol keyword, default label of tiles using it. */
export const MediaLabelSchema = TileLabelSchema;

export const PatchMediaSchema = z.object({ label: MediaLabelSchema }).strict();
export type PatchMedia = z.infer<typeof PatchMediaSchema>;

export interface MediaInfo {
  id: string;
  label: string;
  mime: MediaType;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export interface MediaUsage {
  count: number;
  bytes: number;
}

/** GET /api/media (newest first). */
export interface MediaList {
  items: MediaInfo[];
  usage: MediaUsage;
}

/** POST /api/media, PATCH /api/media/:id */
export interface MediaSaved {
  media: MediaInfo;
  usage: MediaUsage;
}

/** DELETE /api/media/:id: tiles that showed the photo are left with their label only. */
export interface MediaDeleted extends BoardChanges {
  usage: MediaUsage;
}

/** Same-origin URL of an own photo. */
export const mediaUrl = (id: string) => `/api/media/${id}`;

/**
 * Whether a photo's name matches a search: every query word starts a word of the name,
 * after the same normalization as the symbol library ("Mama Ania" ← "ani", "mam").
 */
export function labelMatches(label: string, query: string): boolean {
  const wanted = tokenize(query);
  if (wanted.length === 0) return false;
  const words = tokenize(label);
  return wanted.every((q) => words.some((w) => w.startsWith(q)));
}
