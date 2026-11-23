import { z } from 'zod';
import { ObjectIdSchema, TileLabelSchema, type BoardPackage } from './boards.ts';
import type { SharePhoto } from './share.ts';

/**
 * Catalogue of public boards (PLAN §2.8): copies published by admins, browsed, looked at
 * and copied by every signed-in account. Own photos are in an entry only when the admin
 * publishing it said so explicitly.
 */
export const CATALOG_LIMITS = {
  maxEntries: 200,
  descriptionMax: 500,
} as const;

/** Plain text; line breaks allowed, other control characters not. */
const DescriptionSchema = z
  .string()
  .normalize('NFC')
  .trim()
  .max(CATALOG_LIMITS.descriptionMax)
  .refine((s) => !/(?!\n)[\p{Cc}\p{Cs}\u2028\u2029]/u.test(s), 'control characters');

export const PublishCatalogSchema = z
  .object({
    boardId: ObjectIdSchema,
    name: TileLabelSchema,
    description: DescriptionSchema,
    /** Explicit consent: without it own photos are left out (tiles keep their label). */
    includePhotos: z.boolean(),
  })
  .strict();
export type PublishCatalog = z.infer<typeof PublishCatalogSchema>;

export const PatchCatalogSchema = z
  .object({ name: TileLabelSchema.optional(), description: DescriptionSchema.optional() })
  .strict()
  .refine((p) => p.name !== undefined || p.description !== undefined, 'nothing to change');
export type PatchCatalog = z.infer<typeof PatchCatalogSchema>;

/**
 * PUT /api/admin/catalog/:id/content: a new version of an entry from one's own board. The
 * name, description and place in the list stay; copies already made do not change.
 */
export const ReplaceCatalogSchema = z
  .object({ boardId: ObjectIdSchema, includePhotos: z.boolean() })
  .strict();
export type ReplaceCatalog = z.infer<typeof ReplaceCatalogSchema>;

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  boards: number;
  tiles: number;
  photos: number;
  bytes: number;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/catalog/:id */
export interface CatalogView {
  entry: CatalogEntry;
  package: BoardPackage;
  photos: SharePhoto[];
}

export const catalogPhotoUrl = (entryId: string, key: string) =>
  `/api/catalog/${entryId}/photos/${key}`;
