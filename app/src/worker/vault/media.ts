import {
  MEDIA_LIMITS,
  type MediaInfo,
  type MediaSaved,
  type MediaType,
  type MediaUsage,
} from '@aplikaacja/shared';
import { newId, sha256Hex } from '../lib/crypto.ts';
import type { CleanImage } from '../media/image.ts';

export type MediaError = { error: 'not_found' | 'quota_exceeded' };

/** A photo travelling with a board package (sharing, F6); `key` is its ID at the sender. */
export type PackagePhoto = {
  key: string;
  label: string;
  mime: MediaType;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  data: ArrayBuffer;
};

type MediaRow = {
  id: string;
  label: string;
  mime: MediaType;
  width: number;
  height: number;
  bytes: number;
  created_at: number;
};

const COLUMNS = 'id, label, mime, width, height, bytes, created_at';

const toInfo = (r: MediaRow): MediaInfo => ({
  id: r.id,
  label: r.label,
  mime: r.mime,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  createdAt: r.created_at,
});

/** A standalone ArrayBuffer with exactly the view's bytes (what SQLite BLOB binding takes). */
function ownBuffer(view: Uint8Array): ArrayBuffer {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
    ? (view.buffer as ArrayBuffer)
    : (view.slice().buffer as ArrayBuffer);
}

/**
 * Own photos in the vault: metadata in `media`, bytes in `media_data`. Deleting a photo
 * also changes tiles, so it lives in BoardStore.removeMedia.
 */
export class MediaStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private get sql(): SqlStorage {
    return this.storage.sql;
  }

  usage(): MediaUsage {
    const { count, bytes } = this.sql
      .exec<{ count: number; bytes: number }>(
        'SELECT media AS count, media_bytes AS bytes FROM vault_meta WHERE id = 1',
      )
      .one();
    return { count, bytes };
  }

  list(): MediaInfo[] {
    return this.sql
      .exec<MediaRow>(`SELECT ${COLUMNS} FROM media ORDER BY created_at DESC, id`)
      .toArray()
      .map(toInfo);
  }

  exists(id: string): boolean {
    return this.sql.exec('SELECT 1 FROM media WHERE id = ?', id).toArray().length > 0;
  }

  get(id: string): { mime: MediaType; data: ArrayBuffer } | null {
    return (
      this.sql
        .exec<{ mime: MediaType; data: ArrayBuffer }>(
          'SELECT m.mime, d.data FROM media m JOIN media_data d ON d.id = m.id WHERE m.id = ?',
          id,
        )
        .toArray()[0] ?? null
    );
  }

  /** `image` must come from cleanImage, `label` from MediaLabelSchema. */
  async put(label: string, image: CleanImage): Promise<MediaSaved | MediaError> {
    const sha256 = await sha256Hex(image.data);
    return this.storage.transactionSync(() => {
      const usage = this.usage();
      if (
        usage.count + 1 > MEDIA_LIMITS.maxCount ||
        usage.bytes + image.data.byteLength > MEDIA_LIMITS.maxTotalBytes
      ) {
        return { error: 'quota_exceeded' } as const;
      }
      const row: MediaRow = {
        id: newId(),
        label,
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: image.data.byteLength,
        created_at: this.now(),
      };
      this.sql.exec(
        `INSERT INTO media (id, label, mime, width, height, bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.label,
        row.mime,
        row.width,
        row.height,
        row.bytes,
        sha256,
        row.created_at,
      );
      this.sql.exec(
        'INSERT INTO media_data (id, data) VALUES (?, ?)',
        row.id,
        ownBuffer(image.data),
      );
      return { media: toInfo(row), usage: this.usage() };
    });
  }

  /** `label` must come from MediaLabelSchema. */
  rename(id: string, label: string): MediaSaved | MediaError {
    const row = this.sql
      .exec<MediaRow>(`UPDATE media SET label = ? WHERE id = ? RETURNING ${COLUMNS}`, label, id)
      .toArray()[0];
    return row ? { media: toInfo(row), usage: this.usage() } : { error: 'not_found' };
  }

  /** Photos `ids` with their bytes, for a package (unknown IDs are skipped). */
  forPackage(ids: string[]): PackagePhoto[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(', ');
    return this.sql
      .exec<PackagePhoto>(
        `SELECT m.id AS key, m.label, m.mime, m.width, m.height, m.bytes, m.sha256, d.data
           FROM media m JOIN media_data d ON d.id = m.id WHERE m.id IN (${marks})`,
        ...ids,
      )
      .toArray();
  }

  /** The IDs of `ids` that are photos of this vault, each mapped to itself. */
  existing(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const marks = ids.map(() => '?').join(', ');
    return new Map(
      this.sql
        .exec<{ id: string }>(`SELECT id FROM media WHERE id IN (${marks})`, ...ids)
        .toArray()
        .map((r) => [r.id, r.id]),
    );
  }

  /**
   * Stores the photos of an accepted package (inside the caller's transaction) and maps
   * their keys to media IDs here. A photo this vault already has (same bytes) is reused
   * instead of stored twice. Null when the new ones do not fit the quota.
   */
  addFromPackage(photos: readonly PackagePhoto[]): Map<string, string> | null {
    const ids = new Map<string, string>();
    const fresh: PackagePhoto[] = [];
    for (const photo of photos) {
      const existing = this.sql
        .exec<{ id: string }>('SELECT id FROM media WHERE sha256 = ? LIMIT 1', photo.sha256)
        .toArray()[0];
      if (existing) ids.set(photo.key, existing.id);
      else fresh.push(photo);
    }
    const usage = this.usage();
    const bytes = fresh.reduce((sum, p) => sum + p.bytes, 0);
    if (
      usage.count + fresh.length > MEDIA_LIMITS.maxCount ||
      usage.bytes + bytes > MEDIA_LIMITS.maxTotalBytes
    ) {
      return null;
    }
    const now = this.now();
    for (const photo of fresh) {
      const id = newId();
      this.sql.exec(
        `INSERT INTO media (id, label, mime, width, height, bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        photo.label,
        photo.mime,
        photo.width,
        photo.height,
        photo.bytes,
        photo.sha256,
        now,
      );
      this.sql.exec('INSERT INTO media_data (id, data) VALUES (?, ?)', id, photo.data);
      ids.set(photo.key, id);
    }
    return ids;
  }
}
