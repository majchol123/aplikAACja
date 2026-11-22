import { z } from 'zod';
import { ObjectIdSchema, type BoardPackage } from './boards.ts';
import type { MediaType } from './media.ts';

/**
 * Sending a copy of a board to another account (PLAN §2.8). The answer never tells whether
 * an account with that address exists: using an AAC app is close to health data.
 */
export const SHARE_LIMITS = {
  /** One package: a board with its sub-boards and the photos on them. */
  maxBoards: 100,
  maxTiles: 2000,
  maxPhotos: 200,
  maxPhotoBytes: 10 * 1024 * 1024,
  /** Waiting in one inbox; more are dropped silently (the sender sees "waiting"). */
  maxPending: 20,
  /** Sent by one account per UTC day. */
  maxSendsPerDay: 20,
  /** Undecided shares disappear from the inbox after this long. */
  expiryMs: 30 * 24 * 3600 * 1000,
} as const;

export const SendShareSchema = z
  .object({
    boardId: ObjectIdSchema,
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  })
  .strict();
export type SendShare = z.infer<typeof SendShareSchema>;

export const AcceptShareSchema = z
  .object({ boardId: ObjectIdSchema, rev: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) })
  .strict();
export type AcceptShare = z.infer<typeof AcceptShareSchema>;

export type ShareStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

export interface ShareCounts {
  boards: number;
  tiles: number;
  photos: number;
  bytes: number;
}

/** A share as its sender sees it: the address typed, never whether it reached anyone. */
export interface SentShare extends ShareCounts {
  id: string;
  recipient: string;
  name: string;
  status: ShareStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
}

/** A share waiting in the inbox; the sender is null once that account was deleted. */
export interface ReceivedShare extends ShareCounts {
  id: string;
  name: string;
  sender: { name: string | null; email: string } | null;
  createdAt: number;
  expiresAt: number;
}

/** GET /api/shares */
export interface ShareLists {
  received: ReceivedShare[];
  sent: SentShare[];
}

/** One photo of a received package (bytes at receivedSharePhotoUrl). */
export type SharePhoto = {
  key: string;
  label: string;
  mime: MediaType;
  width: number;
  height: number;
  bytes: number;
};

/** GET /api/shares/received/:id: everything needed to look at it before deciding. */
export interface ReceivedShareView {
  share: ReceivedShare;
  package: BoardPackage;
  photos: SharePhoto[];
}

export const receivedSharePhotoUrl = (shareId: string, key: string) =>
  `/api/shares/received/${shareId}/photos/${key}`;

/** The message shown after sending, whatever happened to the share. */
export const SHARE_SENT_MESSAGE =
  'Jeśli konto z tym adresem istnieje, tablica czeka w jego skrzynce „Otrzymane tablice”.';
