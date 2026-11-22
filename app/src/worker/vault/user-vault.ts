import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type BoardChanges,
  type CreateHome,
  type CreateTile,
  type MediaDeleted,
  type MediaList,
  type MediaSaved,
  type MediaType,
  type MoveTile,
  type PatchBoard,
  type PatchTile,
  type PreferredSymbol,
  type PutPreferred,
  type Settings,
  type SettingsPatch,
} from '@relaacja/shared';
import type { AppEnv } from '../env.ts';
import type { CleanImage } from '../media/image.ts';
import { BoardStore, type BoardError } from './boards.ts';
import { MediaStore, type MediaError } from './media.ts';
import { PreferredStore, type PreferredError } from './preferred.ts';
import { migrateVault } from './schema.ts';

/** Per-user write budget (token bucket, in memory; resets on eviction, which is acceptable). */
const WRITE_BURST = 120;
const WRITE_REFILL_PER_S = 2;

/** Returned (not thrown) by write methods, so it is not logged as a DO exception. */
export const RATE_LIMITED = { error: 'rate_limited' } as const;
export type RateLimited = typeof RATE_LIMITED;

export type BoardResult = BoardChanges | BoardError | RateLimited;

/**
 * All content of one user lives in one SQLite-backed Durable Object addressed by the
 * user's ID. The Worker derives the stub from the session only (vaultFor), so no request
 * parameter can ever select another user's vault.
 */
export class UserVault extends DurableObject<AppEnv> {
  private tokens = WRITE_BURST;
  private refilledAt = Date.now();
  private readonly boards: BoardStore;
  private readonly preferred: PreferredStore;
  private readonly media: MediaStore;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      migrateVault(ctx.storage);
    });
    this.boards = new BoardStore(ctx.storage);
    this.preferred = new PreferredStore(ctx.storage);
    this.media = new MediaStore(ctx.storage);
  }

  private spendWrite(cost = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      WRITE_BURST,
      this.tokens + ((now - this.refilledAt) / 1000) * WRITE_REFILL_PER_S,
    );
    this.refilledAt = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  getSettings(): Settings {
    const stored: Record<string, unknown> = {};
    for (const row of this.ctx.storage.sql.exec<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    )) {
      stored[row.key] = JSON.parse(row.value);
    }
    // Values written by older code may no longer validate: fall back to defaults per key.
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const [key, value] of Object.entries(stored)) {
      const candidate = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, [key]: value });
      if (candidate.success) merged[key] = value;
    }
    return SettingsSchema.parse(merged);
  }

  /** `patch` must already be validated with SettingsPatchSchema by the caller. */
  updateSettings(patch: SettingsPatch): Settings | RateLimited {
    if (!this.spendWrite()) return RATE_LIMITED;
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        sql.exec(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(value),
        );
      }
    });
    return this.getSettings();
  }

  // --- boards (inputs validated with the shared Zod schemas by the caller) ----------

  /** Whole tree as JSON, or `json: null` when one of `known` is the current ETag. */
  getBoardTree(known: string[]): { etag: string; json: string | null } {
    return this.boards.treeJson(known);
  }

  createHomeBoard(input: CreateHome): BoardResult {
    return this.spendWrite() ? this.boards.createHome(input) : RATE_LIMITED;
  }

  patchBoard(id: string, input: PatchBoard): BoardResult {
    return this.spendWrite() ? this.boards.patchBoard(id, input) : RATE_LIMITED;
  }

  createTile(boardId: string, input: CreateTile): BoardResult {
    return this.spendWrite() ? this.boards.createTile(boardId, input) : RATE_LIMITED;
  }

  patchTile(id: string, input: PatchTile): BoardResult {
    return this.spendWrite() ? this.boards.patchTile(id, input) : RATE_LIMITED;
  }

  deleteTile(id: string, rev: number): BoardResult {
    return this.spendWrite() ? this.boards.deleteTile(id, rev) : RATE_LIMITED;
  }

  moveTile(input: MoveTile): BoardResult {
    return this.spendWrite() ? this.boards.moveTile(input) : RATE_LIMITED;
  }

  // --- preferred symbol variants -----------------------------------------------------

  getPreferredSymbols(): PreferredSymbol[] {
    return this.preferred.list();
  }

  /** `input` must already be validated with PutPreferredSchema by the caller. */
  putPreferredSymbol(input: PutPreferred): PreferredSymbol | PreferredError | RateLimited {
    return this.spendWrite() ? this.preferred.put(input) : RATE_LIMITED;
  }

  // --- own photos -------------------------------------------------------------------

  getMediaList(): MediaList {
    return { items: this.media.list(), usage: this.media.usage() };
  }

  getMedia(id: string): { mime: MediaType; data: ArrayBuffer } | null {
    return this.media.get(id);
  }

  /** `image` must come from cleanImage, `label` from MediaLabelSchema. */
  async putMedia(label: string, image: CleanImage): Promise<MediaSaved | MediaError | RateLimited> {
    return this.spendWrite() ? this.media.put(label, image) : RATE_LIMITED;
  }

  renameMedia(id: string, label: string): MediaSaved | MediaError | RateLimited {
    return this.spendWrite() ? this.media.rename(id, label) : RATE_LIMITED;
  }

  deleteMedia(id: string): MediaDeleted | BoardError | RateLimited {
    if (!this.spendWrite()) return RATE_LIMITED;
    const result = this.boards.removeMedia(id);
    return 'error' in result ? result : { ...result, usage: this.media.usage() };
  }

  /** Hard delete of everything the user owns (PLAN §4.3). Idempotent. */
  async deleteAll(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  schemaVersion(): number {
    return this.ctx.storage.sql
      .exec<{ version: number }>('SELECT version FROM _schema WHERE id = 1')
      .one().version;
  }
}

/**
 * The only way to reach a vault: derived from the authenticated session. Deployed
 * environments pin storage to the EU jurisdiction (not implemented in local workerd).
 * Changing DO_JURISDICTION after launch would orphan existing vaults — never do it.
 */
export function vaultFor(env: AppEnv, userId: string): DurableObjectStub<UserVault> {
  const ns = env.DO_JURISDICTION === 'eu' ? env.USER_VAULT.jurisdiction('eu') : env.USER_VAULT;
  return ns.getByName(userId);
}
