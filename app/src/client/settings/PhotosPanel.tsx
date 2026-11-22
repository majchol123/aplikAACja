import { BOARD_LIMITS, MEDIA_LIMITS, mediaUrl, type MediaInfo } from '@relaacja/shared';
import { useId, useMemo, useState } from 'react';
import { useBoardTree } from '../boards/data.ts';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { photoProblem, useDeletePhoto, useMediaList, useRenamePhoto } from '../media/data.ts';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';
/** "na 1 kafelku / 3 kafelkach", "z 1 kafelka / 3 kafelków". */
const ON_TILES = ['kafelku', 'kafelkach', 'kafelkach'] as const;
const FROM_TILES = ['kafelka', 'kafelków', 'kafelków'] as const;
const PHOTOS_PL = ['zdjęcie', 'zdjęcia', 'zdjęć'] as const;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}

/** Own photos of the account: names, where they are used, deleting (PLAN §2.2). */
export function PhotosPanel() {
  const id = useId();
  const photos = useMediaList();
  const tree = useBoardTree();
  const rename = useRenamePhoto();
  const remove = useDeletePhoto();
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState<MediaInfo | null>(null);

  // Tiles per photo, from the board tree already in memory.
  const uses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const board of tree.data?.boards ?? []) {
      for (const tile of board.tiles) {
        if (tile.symbol?.set === 'own') {
          counts.set(tile.symbol.ref, (counts.get(tile.symbol.ref) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [tree.data]);

  const usage = photos.data?.usage;
  const items = photos.data?.items ?? [];
  const share = usage
    ? Math.max(usage.count / MEDIA_LIMITS.maxCount, usage.bytes / MEDIA_LIMITS.maxTotalBytes)
    : 0;

  async function saveName(): Promise<void> {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    try {
      await rename.mutateAsync({ id: editing.id, label });
      setEditing(null);
    } catch {
      // Shown under the list (rename.error).
    }
  }

  const usedOn = (photo: MediaInfo) => uses.get(photo.id) ?? 0;

  return (
    <section className={card} aria-labelledby={`${id}-title`} data-testid="photos-panel">
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Moje zdjęcia
      </h2>
      <p className="mt-1 text-slate-600">
        Zdjęcia dodaje się w trybie edycji, w oknie kafelka („Zrób zdjęcie”, „Wybierz zdjęcie”).
        Widać je tylko na tym koncie.
      </p>
      {usage && (
        <div className="mt-3">
          <p className="text-sm text-slate-700" data-testid="photos-usage">
            {countPl(usage.count, PHOTOS_PL)} z {MEDIA_LIMITS.maxCount} · {size(usage.bytes)} z{' '}
            {size(MEDIA_LIMITS.maxTotalBytes)}
          </p>
          <div
            className="mt-1 h-2 max-w-md overflow-hidden rounded-full bg-slate-200"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.min(100, Math.max(share * 100, usage.count ? 1 : 0))}%` }}
            />
          </div>
        </div>
      )}
      {photos.isError && <p className="mt-3 text-red-800">Nie udało się wczytać zdjęć.</p>}

      {items.length > 0 && (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
          {items.map((photo) => (
            <li key={photo.id} className="flex flex-col rounded-xl border border-slate-200 p-2">
              <img
                src={mediaUrl(photo.id)}
                alt=""
                width={160}
                height={160}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full rounded-lg bg-slate-100 object-contain"
              />
              {editing?.id === photo.id ? (
                <form
                  className="mt-2 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveName();
                  }}
                >
                  <label className={ui.field}>
                    Nazwa zdjęcia
                    <input
                      value={editing.label}
                      maxLength={BOARD_LIMITS.labelMax}
                      onChange={(e) => setEditing({ id: photo.id, label: e.target.value })}
                      className={ui.input}
                      autoComplete="off"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-sm underline"
                      onClick={() => setEditing(null)}
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      className="ml-auto text-sm font-semibold text-brand-800 underline"
                    >
                      Zapisz nazwę
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="mt-2 font-semibold text-slate-800">{photo.label}</p>
                  <p className="text-sm text-slate-600">
                    {usedOn(photo) ? `Na ${countPl(usedOn(photo), ON_TILES)}` : 'Nieużywane'}
                  </p>
                  <div className="mt-auto flex gap-3 pt-2 text-sm">
                    <button
                      type="button"
                      className="text-brand-800 underline underline-offset-4"
                      aria-label={`Zmień nazwę: ${photo.label}`}
                      onClick={() => {
                        rename.reset();
                        setEditing({ id: photo.id, label: photo.label });
                      }}
                    >
                      Zmień nazwę
                    </button>
                    <button
                      type="button"
                      className="ml-auto text-red-800 underline underline-offset-4"
                      aria-label={`Usuń zdjęcie: ${photo.label}`}
                      onClick={() => {
                        remove.reset();
                        setDeleting(photo);
                      }}
                    >
                      Usuń
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {rename.isError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-red-800">
          {photoProblem(rename.error)}
        </p>
      )}

      {deleting && (
        <Dialog title={`Usunąć zdjęcie „${deleting.label}”?`} onClose={() => setDeleting(null)}>
          <p className="mt-3 text-slate-700">
            {usedOn(deleting)
              ? `Zdjęcie zniknie z ${countPl(usedOn(deleting), FROM_TILES)}; zostaną na nich same napisy. `
              : ''}
            Tego nie da się cofnąć.
          </p>
          {remove.isError && (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-red-800">
              {photoProblem(remove.error)}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button type="button" className={ui.secondary} onClick={() => setDeleting(null)}>
              Wróć
            </button>
            <button
              type="button"
              className={ui.danger}
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}
            >
              Usuń
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
