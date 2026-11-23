import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  MEDIA_LIMITS,
  type BoardChanges,
  type MediaDeleted,
  type MediaList,
  type MediaSaved,
} from '@aplikaacja/shared';
import { describe, expect, it } from 'vitest';
import { cleanImage, type CleanImage } from '../src/worker/media/image.ts';
import { vaultFor, type UserVault } from '../src/worker/vault/user-vault.ts';
import {
  apiAs,
  insertUser,
  makeApp,
  formHeaders,
  photoForm,
  sessionCookie,
  uploadAs,
  writeHeaders,
} from './helpers.ts';
import { contains, jpeg, png, webp, webpLossless } from './images.ts';

const clean = (bytes: Uint8Array) => cleanImage(bytes) as CleanImage;
const METADATA = ['GPSLatitude', 'Exif', 'Kowalski', 'xmpmeta', 'trailing'];

describe('uploaded images are checked by signature and stripped of metadata', () => {
  it('PNG: IHDR dimensions; EXIF and text chunks and trailing bytes dropped', () => {
    const image = clean(png(300, 200, { metadata: true }));
    expect(image).toMatchObject({ mime: 'image/png', width: 300, height: 200 });
    for (const word of METADATA) expect(contains(image.data, word), word).toBe(false);
    expect(image.data).toEqual(png(300, 200));
  });

  it('JPEG: frame dimensions; APP1 (EXIF/XMP) and comments dropped, JFIF kept', () => {
    const image = clean(jpeg(512, 384, { metadata: true }));
    expect(image).toMatchObject({ mime: 'image/jpeg', width: 512, height: 384 });
    for (const word of METADATA) expect(contains(image.data, word), word).toBe(false);
    expect(image.data).toEqual(jpeg(512, 384));
    expect(contains(image.data, 'JFIF')).toBe(true);
  });

  it('WebP: lossy, lossless and extended; EXIF/XMP chunks and their flags dropped', () => {
    expect(clean(webp(64, 48))).toMatchObject({ mime: 'image/webp', width: 64, height: 48 });
    expect(clean(webpLossless(512, 1))).toMatchObject({ width: 512, height: 1 });
    const image = clean(webp(512, 512, { metadata: true }));
    expect(image).toMatchObject({ width: 512, height: 512 });
    for (const word of METADATA) expect(contains(image.data, word), word).toBe(false);
    const view = new DataView(image.data.buffer);
    expect(view.getUint32(4, true)).toBe(image.data.length - 8); // RIFF size fixed up
    expect(image.data[20]! & 0x0c).toBe(0); // VP8X: no EXIF / XMP flags
  });

  it('refuses other types, animations, broken files and pictures over 512 px', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    for (const [bytes, problem] of [
      [text('GIF89a\x01\x00\x01\x00'), 'unsupported_type'],
      [
        text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        'unsupported_type',
      ],
      [text('<!doctype html><script>alert(1)</script>'), 'unsupported_type'],
      [new Uint8Array(), 'unsupported_type'],
      [webp(64, 64, { animated: true }), 'unsupported_type'],
      [png(64, 64).subarray(0, 40), 'invalid_image'],
      [jpeg(64, 64).subarray(0, 30), 'invalid_image'],
      [webp(64, 64).subarray(0, 20), 'invalid_image'],
      [png(0, 64), 'invalid_image'],
      [png(513, 64), 'too_large'],
      [jpeg(64, 600), 'too_large'],
      [webp(1000, 1000, { metadata: true }), 'too_large'],
    ] as const) {
      expect(cleanImage(bytes)).toEqual({ error: problem });
    }
  });
});

async function setup() {
  const { call } = makeApp();
  const user = await insertUser();
  const cookie = await sessionCookie(user.id);
  return { call, user, cookie, api: apiAs(call, cookie), upload: uploadAs(call, cookie) };
}

describe('own photos API (PLAN §2.2)', () => {
  it('stores a photo without metadata and serves it back as an image only', async () => {
    const { call, cookie, api, upload, user } = await setup();
    const sent = jpeg(512, 512, { metadata: true });
    const saved = await upload<MediaSaved>('Mama', sent, 'image/jpeg');
    expect(saved.status).toBe(201);
    const { media, usage } = saved.body;
    expect(media).toMatchObject({ label: 'Mama', mime: 'image/jpeg', width: 512, height: 512 });
    expect(media.bytes).toBe(jpeg(512, 512).length);
    expect(usage).toEqual({ count: 1, bytes: media.bytes });

    const res = await call(`/api/media/${media.id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const stored = new Uint8Array(await res.arrayBuffer());
    expect(stored).toEqual(jpeg(512, 512));
    expect(contains(stored, 'GPSLatitude')).toBe(false);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Content-Disposition')).toBe('inline');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');

    const list = await api<MediaList>('GET', '/api/media');
    expect(list.body).toEqual({ items: [media], usage });
    // Admin overview of used storage (D1).
    const row = await env.DB.prepare('SELECT storage_bytes FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ storage_bytes: number }>();
    expect(row?.storage_bytes).toBe(media.bytes);
  });

  it('validates the form, the type is decided by the bytes, not by the client', async () => {
    const { call, cookie, upload } = await setup();
    expect((await upload(undefined, webp(64, 64))).status).toBe(400);
    expect((await upload('', webp(64, 64))).status).toBe(400);
    expect((await upload('x'.repeat(81), webp(64, 64))).status).toBe(400);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(await upload('svg', svg, 'image/webp')).toMatchObject({
      status: 415,
      body: { error: 'unsupported_type' },
    });
    expect((await upload('duże', png(1024, 768))).status).toBe(422);
    expect((await upload('pęknięte', png(64, 64).subarray(0, 30))).status).toBe(400);
    // A PNG called WebP by the client is stored as what it is.
    const renamed = await upload<MediaSaved>('png', png(64, 64), 'image/webp');
    expect(renamed.body.media.mime).toBe('image/png');

    const big = new Uint8Array(MEDIA_LIMITS.maxFileBytes + 1);
    expect((await upload('za duże', big)).status).toBe(413);
    const headers = formHeaders(cookie);
    const huge = new Uint8Array(MEDIA_LIMITS.maxFileBytes + 64 * 1024);
    const tooLong = await call('/api/media', {
      method: 'POST',
      headers,
      body: photoForm('x', huge),
    });
    expect(tooLong.status).toBe(413);
    // JSON instead of a form.
    const json = await call('/api/media', {
      method: 'POST',
      headers: writeHeaders(cookie),
      body: JSON.stringify({ label: 'x', image: 'AAAA' }),
    });
    expect(json.status).toBe(400);
  });

  it('multipart bodies pass the CSRF guard on the upload route only', async () => {
    const { call, cookie } = await setup();
    const headers = formHeaders(cookie);
    const settings = await call('/api/settings', {
      method: 'PATCH',
      headers,
      body: photoForm('x', webp(8, 8)),
    });
    expect(settings.status).toBe(403);
    const raw = await call('/api/media', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/webp' },
      body: webp(8, 8),
    });
    expect(raw.status).toBe(403);
    const foreign = await call('/api/media', {
      method: 'POST',
      headers: { ...headers, Origin: 'https://evil.one.pl' },
      body: photoForm('x', webp(8, 8)),
    });
    expect(foreign.status).toBe(403);
  });

  it('tiles and preferred variants may show own photos that exist', async () => {
    const { api, upload } = await setup();
    const photo = (await upload<MediaSaved>('Babcia', webp(256, 256))).body.media;
    const home = await api<BoardChanges>('POST', '/api/boards/home', {
      name: 'Start',
      rows: 2,
      cols: 2,
    });
    const boardId = home.body.boards[0]!.id;
    const own = { set: 'own', ref: photo.id };
    const missing = { set: 'own', ref: 'a'.repeat(26) };
    const tile = await api('POST', `/api/boards/${boardId}/tiles`, {
      rev: 1,
      row: 0,
      col: 0,
      kind: 'word',
      label: 'babcia',
      symbol: own,
    });
    expect(tile.status).toBe(201);
    const unknown = await api('POST', `/api/boards/${boardId}/tiles`, {
      rev: 2,
      row: 0,
      col: 1,
      kind: 'word',
      label: 'x',
      symbol: missing,
    });
    expect(unknown).toMatchObject({ status: 422, body: { error: 'unknown_symbol' } });
    const word = { word: 'babcia', symbol: own };
    expect((await api('PUT', '/api/symbols/preferred', word)).status).toBe(200);
    const dangling = await api('PUT', '/api/symbols/preferred', { word: 'x', symbol: missing });
    expect(dangling).toMatchObject({ status: 422, body: { error: 'unknown_symbol' } });
  });

  it('renames; deleting a photo leaves its tiles with the label only', async () => {
    const { call, cookie, api, upload } = await setup();
    const photo = (await upload<MediaSaved>('Pies', webp(128, 128))).body.media;
    const other = (await upload<MediaSaved>('Kot', webp(128, 128))).body.media;
    const renamed = await api<MediaSaved>('PATCH', `/api/media/${photo.id}`, { label: 'Burek' });
    expect(renamed.body.media).toEqual({ ...photo, label: 'Burek' });
    expect((await api('PATCH', `/api/media/${photo.id}`, { label: '' })).status).toBe(400);

    const home = await api<BoardChanges>('POST', '/api/boards/home', {
      name: 'Start',
      rows: 2,
      cols: 2,
    });
    const boardId = home.body.boards[0]!.id;
    let rev = home.body.boards[0]!.rev;
    for (const [row, col, ref] of [
      [0, 0, photo.id],
      [0, 1, photo.id],
      [1, 0, other.id],
    ] as const) {
      const created = await api<BoardChanges>('POST', `/api/boards/${boardId}/tiles`, {
        rev,
        row,
        col,
        kind: 'word',
        label: 'pies',
        symbol: { set: 'own', ref },
      });
      rev = created.body.boards[0]!.rev;
    }
    await api('PUT', '/api/symbols/preferred', {
      word: 'pies',
      symbol: { set: 'own', ref: photo.id },
    });

    const deleted = await api<MediaDeleted>('DELETE', `/api/media/${photo.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.removed).toEqual([]);
    expect(deleted.body.usage).toEqual({ count: 1, bytes: other.bytes });
    const board = deleted.body.boards[0]!;
    expect(board.id).toBe(boardId);
    expect(board.tiles.map((t) => t.symbol)).toEqual([null, null, { set: 'own', ref: other.id }]);
    expect(board.tiles.map((t) => t.label)).toEqual(['pies', 'pies', 'pies']);

    const preferred = await api<{ items: unknown[] }>('GET', '/api/symbols/preferred');
    expect(preferred.body.items).toEqual([]);
    expect((await call(`/api/media/${photo.id}`, { headers: { Cookie: cookie } })).status).toBe(
      404,
    );
    expect((await api('DELETE', `/api/media/${photo.id}`)).status).toBe(404);
    expect((await api('PATCH', `/api/media/${photo.id}`, { label: 'x' })).status).toBe(404);
    // A photo no tile shows: nothing on the boards changes.
    const unused = (await upload<MediaSaved>('Nieużywane', webp(8, 8))).body.media;
    const quiet = await api<MediaDeleted>('DELETE', `/api/media/${unused.id}`);
    expect(quiet.body.boards).toEqual([]);
  });

  it('other accounts get the same 404 as for a missing photo', async () => {
    const a = await setup();
    const photo = (await a.upload<MediaSaved>('Dom', webp(64, 64))).body.media;
    const b = await setup();
    const res = await b.call(`/api/media/${photo.id}`, { headers: { Cookie: b.cookie } });
    expect(res.status).toBe(404);
    expect((await b.api('DELETE', `/api/media/${photo.id}`)).status).toBe(404);
    expect((await b.api('PATCH', `/api/media/${photo.id}`, { label: 'x' })).status).toBe(404);
    expect((await b.api<MediaList>('GET', '/api/media')).body.items).toEqual([]);
    const malformed = await a.call('/api/media/..%2Fx', { headers: { Cookie: a.cookie } });
    expect(malformed.status).toBe(404);
  });

  it('quota: number of photos and bytes, read from the counters', async () => {
    const { upload, user } = await setup();
    await upload('pierwsze', webp(8, 8));
    const set = (column: string, value: number) =>
      runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
        state.storage.sql.exec(`UPDATE vault_meta SET ${column} = ?`, value);
      });
    await set('media', MEDIA_LIMITS.maxCount);
    expect(await upload('za dużo', webp(8, 8))).toMatchObject({
      status: 422,
      body: { error: 'quota_exceeded' },
    });
    await set('media', 1);
    await set('media_bytes', MEDIA_LIMITS.maxTotalBytes - 10);
    expect((await upload('za ciężkie', webp(8, 8))).status).toBe(422);
  });

  it('keeps the counters in step with the table', async () => {
    const { api, upload, user } = await setup();
    const ids: string[] = [];
    for (const size of [8, 16, 32]) {
      ids.push((await upload<MediaSaved>(`p${size}`, webp(size, size))).body.media.id);
    }
    await api('DELETE', `/api/media/${ids[1]}`);
    const counts = await runInDurableObject(vaultFor(env, user.id), (_i: UserVault, state) => {
      const sql = state.storage.sql;
      return {
        meta: sql.exec('SELECT media, media_bytes FROM vault_meta').one(),
        rows: sql.exec('SELECT COUNT(*) AS media, SUM(bytes) AS media_bytes FROM media').one(),
        data: sql.exec('SELECT COUNT(*) AS n FROM media_data').one().n,
      };
    });
    expect(counts.meta).toEqual(counts.rows);
    expect(counts.meta.media).toBe(2);
    expect(counts.data).toBe(2);
  });
});
