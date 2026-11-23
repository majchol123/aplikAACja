import { z } from 'zod';

/**
 * Encrypted backups (PLAN §6, F7). A superadmin sets the age recipient (public key) the
 * data is encrypted for and gets a token for the backup job, shown once. The job fetches
 * everything with that token; the server encrypts each file for the recipient, so the
 * token alone yields ciphertext only and the private key never reaches Cloudflare.
 */

/** age recipient: X25519 (`age1…`) or the post-quantum hybrid (`age1pq1…`), bech32. */
export const AGE_RECIPIENT_RE = /^age1(?:pq1)?[02-9ac-hj-np-z]{40,3000}$/;

export const ConfigureBackupSchema = z
  .object({ recipient: z.string().trim().regex(AGE_RECIPIENT_RE) })
  .strict();
export type ConfigureBackup = z.infer<typeof ConfigureBackupSchema>;

export interface BackupStatus {
  configured: boolean;
  recipient: string | null;
  createdAt: number | null;
  /** Superadmin who set the current recipient and token (ID). */
  createdBy: string | null;
  /** Last start of a backup run (its index request). */
  lastUsedAt: number | null;
}

/** Answer to setting the recipient: the token is in no other answer, ever. */
export interface BackupConfigured {
  status: BackupStatus;
  token: string;
}

/** What one run fetches, in plain text: opaque IDs only. */
export interface BackupIndex {
  v: 1;
  at: number;
  /** Accounts in D1; deleted ones are gone from it and from the backup. */
  users: string[];
  catalog: { id: string; photos: string[] }[];
}

/** Own photos of one account (IDs; the photos are immutable, so a run fetches new ones). */
export interface BackupMediaList {
  media: string[];
}

/** The token the backup job sends as `Authorization: Bearer …`. */
export const BACKUP_TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
