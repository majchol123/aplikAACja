import {
  SHARE_LIMITS,
  type SentShare,
  type ShareCounts,
  type SharePhoto,
  type ShareStatus,
} from '@relaacja/shared';
import { newId } from '../lib/crypto.ts';
import type { PackagePhoto } from './media.ts';

/** A share on its way to an inbox (built by the sender's vault, F6). */
export interface Delivery extends ShareCounts {
  senderId: string;
  shareId: string;
  name: string;
  /** BoardPackage as JSON. */
  package: string;
  files: PackagePhoto[];
  expiresAt: number;
}

/** An inbox entry without its package. */
export interface InboxEntry extends ShareCounts {
  id: string;
  senderId: string;
  name: string;
  createdAt: number;
  expiresAt: number;
}

type InboxRow = {
  id: string;
  sender_id: string;
  share_id: string;
  name: string;
  package: string;
  boards: number;
  tiles: number;
  photos: number;
  bytes: number;
  created_at: number;
  expires_at: number;
};

type OutboxRow = {
  id: string;
  recipient: string;
  name: string;
  status: Exclude<ShareStatus, 'expired'>;
  boards: number;
  tiles: number;
  photos: number;
  bytes: number;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
};

const INBOX_COLUMNS =
  'id, sender_id, share_id, name, boards, tiles, photos, bytes, created_at, expires_at';
/** Kept in the sender's list; older entries are dropped when a new one is added. */
const OUTBOX_KEEP = 100;

const toEntry = (r: Omit<InboxRow, 'package'>): InboxEntry => ({
  id: r.id,
  senderId: r.sender_id,
  name: r.name,
  boards: r.boards,
  tiles: r.tiles,
  photos: r.photos,
  bytes: r.bytes,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

function toSent(r: OutboxRow, now: number): SentShare {
  return {
    id: r.id,
    recipient: r.recipient,
    name: r.name,
    status: r.status === 'pending' && r.expires_at <= now ? 'expired' : r.status,
    boards: r.boards,
    tiles: r.tiles,
    photos: r.photos,
    bytes: r.bytes,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
  };
}

/** UTC day of a timestamp, for the daily send limit. */
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Inbox and outbox of one vault (PLAN §2.8). */
export class ShareStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  private purgeExpired(now: number): void {
    this.sql.exec('DELETE FROM inbox WHERE expires_at <= ?', now);
  }

  // --- inbox (this account receives) ------------------------------------------------

  /** Stores a delivery unless the inbox is full (then it is dropped: nobody is told). */
  deliver(delivery: Delivery, now: number): boolean {
    return this.storage.transactionSync(() => {
      this.purgeExpired(now);
      const pending = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM inbox').one().n;
      if (pending >= SHARE_LIMITS.maxPending) return false;
      const id = newId();
      this.sql.exec(
        `INSERT INTO inbox (id, sender_id, share_id, name, package, boards, tiles, photos, bytes,
                            created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        delivery.senderId,
        delivery.shareId,
        delivery.name,
        delivery.package,
        delivery.boards,
        delivery.tiles,
        delivery.photos,
        delivery.bytes,
        now,
        delivery.expiresAt,
      );
      for (const p of delivery.files) {
        this.sql.exec(
          `INSERT INTO inbox_media (inbox_id, key, label, mime, width, height, bytes, sha256, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          p.key,
          p.label,
          p.mime,
          p.width,
          p.height,
          p.bytes,
          p.sha256,
          p.data,
        );
      }
      return true;
    });
  }

  received(now: number): InboxEntry[] {
    this.purgeExpired(now);
    return this.sql
      .exec<Omit<InboxRow, 'package'>>(
        `SELECT ${INBOX_COLUMNS} FROM inbox ORDER BY created_at DESC, id`,
      )
      .toArray()
      .map(toEntry);
  }

  /** One live inbox entry with its package (JSON), or null. */
  inboxItem(id: string, now: number): (InboxEntry & { shareId: string; package: string }) | null {
    const row = this.sql
      .exec<InboxRow>(
        `SELECT ${INBOX_COLUMNS}, package FROM inbox WHERE id = ? AND expires_at > ?`,
        id,
        now,
      )
      .toArray()[0];
    return row ? { ...toEntry(row), shareId: row.share_id, package: row.package } : null;
  }

  photoInfo(id: string): SharePhoto[] {
    return this.sql
      .exec<SharePhoto>(
        'SELECT key, label, mime, width, height, bytes FROM inbox_media WHERE inbox_id = ? ORDER BY key',
        id,
      )
      .toArray();
  }

  photos(id: string): PackagePhoto[] {
    return this.sql
      .exec<PackagePhoto>(
        'SELECT key, label, mime, width, height, bytes, sha256, data FROM inbox_media WHERE inbox_id = ?',
        id,
      )
      .toArray();
  }

  photo(
    id: string,
    key: string,
    now: number,
  ): { mime: PackagePhoto['mime']; data: ArrayBuffer } | null {
    return (
      this.sql
        .exec<{ mime: PackagePhoto['mime']; data: ArrayBuffer }>(
          `SELECT m.mime, m.data FROM inbox_media m JOIN inbox i ON i.id = m.inbox_id
            WHERE m.inbox_id = ? AND m.key = ? AND i.expires_at > ?`,
          id,
          key,
          now,
        )
        .toArray()[0] ?? null
    );
  }

  /** Removes an inbox entry (and its photos); who sent it, so they can be told. */
  remove(id: string): { senderId: string; shareId: string } | null {
    const row = this.sql
      .exec<{ sender_id: string; share_id: string }>(
        'DELETE FROM inbox WHERE id = ? RETURNING sender_id, share_id',
        id,
      )
      .toArray()[0];
    return row ? { senderId: row.sender_id, shareId: row.share_id } : null;
  }

  // --- outbox (this account sends) --------------------------------------------------

  /** Counts one send against today's limit; false when the limit is reached. */
  spendSend(now: number): boolean {
    const day = dayOf(now);
    const meta = this.sql
      .exec<{ sends_day: string; sends: number }>(
        'SELECT sends_day, sends FROM vault_meta WHERE id = 1',
      )
      .one();
    const sent = meta.sends_day === day ? meta.sends : 0;
    if (sent >= SHARE_LIMITS.maxSendsPerDay) return false;
    this.sql.exec('UPDATE vault_meta SET sends_day = ?, sends = ? WHERE id = 1', day, sent + 1);
    return true;
  }

  recordSent(entry: ShareCounts & { recipient: string; name: string }, now: number): SentShare {
    const row: OutboxRow = {
      id: newId(),
      recipient: entry.recipient,
      name: entry.name,
      status: 'pending',
      boards: entry.boards,
      tiles: entry.tiles,
      photos: entry.photos,
      bytes: entry.bytes,
      created_at: now,
      expires_at: now + SHARE_LIMITS.expiryMs,
      decided_at: null,
    };
    this.sql.exec(
      `INSERT INTO outbox (id, recipient, name, status, boards, tiles, photos, bytes, created_at,
                           expires_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      row.id,
      row.recipient,
      row.name,
      row.status,
      row.boards,
      row.tiles,
      row.photos,
      row.bytes,
      row.created_at,
      row.expires_at,
    );
    this.sql.exec(
      `DELETE FROM outbox WHERE id IN (
         SELECT id FROM outbox ORDER BY created_at DESC, id LIMIT -1 OFFSET ?)`,
      OUTBOX_KEEP,
    );
    return toSent(row, now);
  }

  sent(now: number): SentShare[] {
    return this.sql
      .exec<OutboxRow>('SELECT * FROM outbox ORDER BY created_at DESC, id')
      .toArray()
      .map((r) => toSent(r, now));
  }

  /** The recipient decided; only a waiting share changes. */
  decided(shareId: string, status: 'accepted' | 'rejected', at: number): void {
    this.sql.exec(
      "UPDATE outbox SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      status,
      at,
      shareId,
    );
  }

  removeSent(id: string): boolean {
    return this.sql.exec('DELETE FROM outbox WHERE id = ? RETURNING id', id).toArray().length > 0;
  }
}
