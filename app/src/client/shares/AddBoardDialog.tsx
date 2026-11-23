import {
  catalogPhotoUrl,
  packageTree,
  receivedSharePhotoUrl,
  treeShape,
  type Board,
  type BoardPackage,
  type CatalogEntry,
  type Me,
  type ObzImport,
  type ReceivedShare,
} from '@aplikaacja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo, useState } from 'react';
import { formatBytes, formatDate, BOARDS_PL, PHOTOS_PL, TILES_PL } from '../admin/format.ts';
import { applyChanges, TREE_KEY } from '../boards/data.ts';
import { ReadOnlyBoards } from '../boards/ReadOnlyBoards.tsx';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { MEDIA_KEY } from '../media/data.ts';
import {
  useCatalog,
  useCatalogEntry,
  useCopyFromCatalog,
  useEditEntry,
  useReplaceContent,
  useWithdraw,
} from './catalog.ts';
import {
  shareProblem,
  useAcceptShare,
  useReceivedShare,
  useRejectShare,
  useShares,
} from './data.ts';
import { FileProblem, importBoardFile, readBoardFile } from './files.ts';
import { PlacePicker, type Place } from './PlacePicker.tsx';

const section = 'mt-5 border-t border-slate-200 pt-4';
const item = 'rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200';

/** Who sent it, as far as this account may know. */
export function senderLabel(share: ReceivedShare): string {
  if (!share.sender) return 'konto, które już nie istnieje';
  return share.sender.name ? `${share.sender.name} (${share.sender.email})` : share.sender.email;
}

export function shareSize(share: { boards: number; tiles: number; photos: number; bytes: number }) {
  const parts = [countPl(share.boards, BOARDS_PL), countPl(share.tiles, TILES_PL)];
  if (share.photos > 0) {
    parts.push(`${countPl(share.photos, PHOTOS_PL)} (${formatBytes(share.bytes)})`);
  }
  return parts.join(', ');
}

type Notice = { ok: boolean; text: string } | null;

/**
 * Ready boards to add as a new folder on the board open in the editor (PLAN §2.8): sent by
 * other accounts, from the catalogue of public boards, or read from an Open Board file.
 * Nothing reaches the boards without this.
 */
export function AddBoardDialog({
  me,
  board,
  onClose,
}: {
  me: Me;
  board: Board;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const done = (name: string, on: string, note?: string) =>
    setNotice({
      ok: true,
      text: `Dodano folder „${name}” na tablicy „${on}”.${note ? ` ${note}` : ''}`,
    });
  const failed = (text: string) => setNotice({ ok: false, text });

  return (
    <Dialog title="Dodaj tablicę" onClose={onClose} wide>
      <p className="mt-2 text-slate-700">
        Gotowa tablica pojawi się jako nowy folder w polu, które wybierzesz (na tej albo innej
        tablicy). Możesz ją potem zmieniać jak każdą inną.
      </p>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`mt-3 rounded-xl p-3 ring-1 ${
            notice.ok
              ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
              : 'bg-red-50 text-red-800 ring-red-200'
          }`}
        >
          {notice.text}
        </p>
      )}
      <Received me={me} board={board} onDone={done} onError={failed} />
      <CatalogSection me={me} board={board} onDone={done} onError={failed} />
      <FileImport board={board} onDone={done} onError={failed} onStart={() => setNotice(null)} />
      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}

interface Outcome {
  /** `on`: name of the board the folder landed on. */
  onDone: (name: string, on: string, note?: string) => void;
  onError: (text: string) => void;
}

function Received({ me, board, onDone }: { me: Me; board: Board } & Outcome) {
  const id = useId();
  const shares = useShares();
  const accept = useAcceptShare();
  const [choosing, setChoosing] = useState<ReceivedShare | null>(null);
  const received = shares.data?.received ?? [];
  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Otrzymane od innych kont
      </h3>
      {shares.isPending && (
        <p role="status" className="mt-2 text-slate-600">
          Wczytywanie…
        </p>
      )}
      {shares.isSuccess && received.length === 0 && (
        <p className="mt-2 text-slate-600">Nie ma otrzymanych tablic.</p>
      )}
      <ul className="mt-3 space-y-3">
        {received.map((share) => (
          <InboxItem
            key={share.id}
            me={me}
            share={share}
            busy={accept.isPending}
            onAccept={() => {
              accept.reset();
              setChoosing(share);
            }}
          />
        ))}
      </ul>
      {choosing && (
        <PlacePicker
          name={choosing.name}
          start={board}
          busy={accept.isPending ? 'Dodawanie tablicy…' : null}
          problem={accept.isError ? shareProblem(accept.error) : null}
          onClose={() => setChoosing(null)}
          onPlace={({ board: to, cell }: Place) =>
            accept.mutate(
              { id: choosing.id, boardId: to.id, rev: to.rev, cell },
              {
                onSuccess: () => {
                  setChoosing(null);
                  onDone(choosing.name, to.name);
                },
              },
            )
          }
        />
      )}
    </section>
  );
}

function InboxItem({
  me,
  share,
  busy,
  onAccept,
}: {
  me: Me;
  share: ReceivedShare;
  busy: boolean;
  onAccept: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const reject = useRejectShare();
  return (
    <li className={item} aria-label={share.name}>
      <p className="text-lg font-bold text-brand-900">{share.name}</p>
      <p className="text-slate-700">Od: {senderLabel(share)}</p>
      <p className="text-sm text-slate-600">
        {shareSize(share)}. Otrzymana {formatDate(share.createdAt)}, czeka do{' '}
        {formatDate(share.expiresAt)}.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={ui.primary} disabled={busy} onClick={onAccept}>
          Dodaj…
        </button>
        <button
          type="button"
          className={ui.secondary}
          aria-expanded={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? 'Ukryj podgląd' : 'Podgląd'}
        </button>
        {!rejecting ? (
          <button type="button" className={ui.danger} onClick={() => setRejecting(true)}>
            Odrzuć
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-slate-800">Odrzucić? Nadawca zobaczy, że odrzucono.</span>
            <button
              type="button"
              className={ui.danger}
              disabled={reject.isPending}
              onClick={() => reject.mutate(share.id)}
            >
              Tak, odrzuć
            </button>
            <button type="button" className={ui.secondary} onClick={() => setRejecting(false)}>
              Anuluj
            </button>
          </span>
        )}
      </div>
      {reject.isError && (
        <p role="alert" className="mt-2 text-red-700">
          {shareProblem(reject.error)}
        </p>
      )}
      {preview && <SharePreview me={me} id={share.id} />}
    </li>
  );
}

function PackagePreview({
  me,
  pkg,
  ownUrl,
}: {
  me: Me;
  pkg: BoardPackage;
  ownUrl: (key: string) => string;
}) {
  const tree = useMemo(() => packageTree(pkg), [pkg]);
  return <ReadOnlyBoards me={me} tree={tree} ownUrl={ownUrl} empty="Pusta tablica." />;
}

function SharePreview({ me, id }: { me: Me; id: string }) {
  const view = useReceivedShare(id);
  const ownUrl = useCallback((key: string) => receivedSharePhotoUrl(id, key), [id]);
  if (view.isPending) {
    return (
      <p role="status" className="mt-3 text-slate-600">
        Wczytywanie podglądu…
      </p>
    );
  }
  if (!view.data) {
    return (
      <p role="alert" className="mt-3 text-red-700">
        {shareProblem(view.error)}
      </p>
    );
  }
  return <PackagePreview me={me} pkg={view.data.package} ownUrl={ownUrl} />;
}

function CatalogSection({ me, board, onDone }: { me: Me; board: Board } & Outcome) {
  const id = useId();
  const catalog = useCatalog();
  const copy = useCopyFromCatalog();
  const [choosing, setChoosing] = useState<CatalogEntry | null>(null);
  const entries = catalog.data?.entries ?? [];
  const isAdmin = me.role === 'admin' || me.role === 'superadmin';
  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Katalog tablic publicznych
      </h3>
      <p className="mt-1 text-slate-700">Gotowe tablice przygotowane przez administratorów.</p>
      {catalog.isPending && (
        <p role="status" className="mt-2 text-slate-600">
          Wczytywanie…
        </p>
      )}
      {catalog.isError && (
        <p role="alert" className="mt-2 text-red-700">
          {shareProblem(catalog.error)}
        </p>
      )}
      {catalog.isSuccess && entries.length === 0 && (
        <p className="mt-2 text-slate-600">Katalog jest jeszcze pusty.</p>
      )}
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <CatalogItem
            key={entry.id}
            me={me}
            entry={entry}
            board={board}
            admin={isAdmin}
            busy={copy.isPending}
            onCopy={() => {
              copy.reset();
              setChoosing(entry);
            }}
          />
        ))}
      </ul>
      {choosing && (
        <PlacePicker
          name={choosing.name}
          start={board}
          busy={copy.isPending ? 'Dodawanie tablicy…' : null}
          problem={copy.isError ? shareProblem(copy.error) : null}
          onClose={() => setChoosing(null)}
          onPlace={({ board: to, cell }: Place) =>
            copy.mutate(
              { id: choosing.id, boardId: to.id, rev: to.rev, cell },
              {
                onSuccess: () => {
                  setChoosing(null);
                  onDone(choosing.name, to.name);
                },
              },
            )
          }
        />
      )}
    </section>
  );
}

function CatalogItem({
  me,
  entry,
  board,
  admin,
  busy,
  onCopy,
}: {
  me: Me;
  entry: CatalogEntry;
  /** Admins: the board open in the editor, the source of a new version. */
  board: Board;
  admin: boolean;
  busy: boolean;
  onCopy: () => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [withPhotos, setWithPhotos] = useState(false);
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const edit = useEditEntry();
  const withdraw = useWithdraw();
  const replace = useReplaceContent();
  return (
    <li className={item} aria-label={entry.name}>
      <p className="text-lg font-bold text-brand-900">{entry.name}</p>
      {entry.description && (
        <p className="whitespace-pre-line text-slate-700">{entry.description}</p>
      )}
      <p className="text-sm text-slate-600">{shareSize(entry)}.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={ui.primary} disabled={busy} onClick={onCopy}>
          Dodaj…
        </button>
        <button
          type="button"
          className={ui.secondary}
          aria-expanded={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? 'Ukryj podgląd' : 'Podgląd'}
        </button>
        {admin && !editing && (
          <button type="button" className={ui.secondary} onClick={() => setEditing(true)}>
            Zmień opis
          </button>
        )}
        {admin && !replacing && (
          <button
            type="button"
            className={ui.secondary}
            onClick={() => {
              replace.reset();
              setReplacing(true);
            }}
          >
            Aktualizuj zawartość
          </button>
        )}
        {admin && !withdrawing && (
          <button type="button" className={ui.danger} onClick={() => setWithdrawing(true)}>
            Wycofaj z katalogu
          </button>
        )}
      </div>
      {withdrawing && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-slate-800">
            Wycofać? Kopie dodane już przez innych zostają na ich kontach.
          </span>
          <button
            type="button"
            className={ui.danger}
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate(entry.id)}
          >
            Tak, wycofaj
          </button>
          <button type="button" className={ui.secondary} onClick={() => setWithdrawing(false)}>
            Anuluj
          </button>
        </div>
      )}
      {replacing && (
        <div className="mt-3 space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-slate-800">
            Zawartość wpisu zastąpi tablica „{board.name}” z jej folderami, w obecnej postaci.
            Nazwa, opis i miejsce w katalogu zostaną. Kto już dodał tę tablicę, zachowa swoją kopię.
          </p>
          <label className="flex items-start gap-3 text-slate-700">
            <input
              type="checkbox"
              className="mt-1 size-5 accent-brand-700"
              checked={withPhotos}
              onChange={(e) => setWithPhotos(e.target.checked)}
            />
            Dołącz moje zdjęcia. Zobaczy je każdy, kto otworzy katalog. Bez zgody kafelki ze
            zdjęciami zostaną z samym napisem.
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={ui.primary}
              disabled={replace.isPending}
              onClick={() =>
                replace.mutate(
                  { id: entry.id, boardId: board.id, includePhotos: withPhotos },
                  { onSuccess: () => setReplacing(false) },
                )
              }
            >
              Tak, aktualizuj
            </button>
            <button type="button" className={ui.secondary} onClick={() => setReplacing(false)}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      {replace.isSuccess && !replacing && (
        <p role="status" className="mt-2 text-emerald-800">
          Zaktualizowano zawartość: {shareSize(replace.data)}.
        </p>
      )}
      {editing && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            edit.mutate(
              { id: entry.id, name: name.trim(), description: description.trim() },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <label className={ui.field} htmlFor={`${id}-name`}>
            Nazwa
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
            className={ui.input}
          />
          <label className={ui.field} htmlFor={`${id}-description`}>
            Opis
          </label>
          <textarea
            id={`${id}-description`}
            value={description}
            maxLength={500}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className={ui.input}
          />
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={ui.primary} disabled={edit.isPending || !name.trim()}>
              Zapisz
            </button>
            <button type="button" className={ui.secondary} onClick={() => setEditing(false)}>
              Anuluj
            </button>
          </div>
        </form>
      )}
      {(edit.isError || withdraw.isError || replace.isError) && (
        <p role="alert" className="mt-2 text-red-700">
          {shareProblem(edit.error ?? withdraw.error ?? replace.error)}
        </p>
      )}
      {preview && <CatalogPreview me={me} id={entry.id} />}
    </li>
  );
}

function CatalogPreview({ me, id }: { me: Me; id: string }) {
  const view = useCatalogEntry(id);
  const ownUrl = useCallback((key: string) => catalogPhotoUrl(id, key), [id]);
  if (view.isPending) {
    return (
      <p role="status" className="mt-3 text-slate-600">
        Wczytywanie podglądu…
      </p>
    );
  }
  if (!view.data) {
    return (
      <p role="alert" className="mt-3 text-red-700">
        {shareProblem(view.error)}
      </p>
    );
  }
  return <PackagePreview me={me} pkg={view.data.package} ownUrl={ownUrl} />;
}

function sizeOf(imported: ObzImport): string {
  const shape = treeShape(imported.package.board, imported.package.name, { allowOwn: true });
  const parts = [countPl(shape.boards, BOARDS_PL), countPl(shape.tiles, TILES_PL)];
  if (imported.photos.length) parts.push(countPl(imported.photos.length, PHOTOS_PL));
  return parts.join(', ');
}

function FileImport({
  board,
  onDone,
  onError,
  onStart,
}: { board: Board; onStart: () => void } & Outcome) {
  const id = useId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<ObzImport | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeProblem, setPlaceProblem] = useState<string | null>(null);
  const problem = (err: unknown) => (err instanceof FileProblem ? err.message : shareProblem(err));

  async function read(file: File | undefined): Promise<void> {
    onStart();
    setImported(null);
    if (!file) return;
    setBusy('Odczytywanie pliku…');
    try {
      setImported(await readBoardFile(file));
    } catch (err) {
      onError(problem(err));
    } finally {
      setBusy(null);
    }
  }

  async function add({ board: to, cell }: Place): Promise<void> {
    if (!imported) return;
    setPlaceProblem(null);
    try {
      const { changes, skippedPhotos } = await importBoardFile(
        imported,
        { id: to.id, rev: to.rev, cell },
        (done, total) =>
          setBusy(total ? `Wysyłanie zdjęć: ${done} z ${total}…` : 'Dodawanie tablicy…'),
      );
      applyChanges(queryClient, changes);
      setPlacing(false);
      onDone(
        imported.package.name,
        to.name,
        skippedPhotos
          ? `Pominięto zdjęcia, których nie dało się odczytać: ${skippedPhotos}.`
          : undefined,
      );
      setImported(null);
    } catch (err) {
      setPlaceProblem(problem(err));
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
    } finally {
      void queryClient.invalidateQueries({ queryKey: MEDIA_KEY });
      setBusy(null);
    }
  }

  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Z pliku Open Board (.obz, .obf)
      </h3>
      <p className="mt-1 text-slate-700">
        Plik zapisany w aplikAACja albo w innej aplikacji AAC. Obrazki z pliku zostaną Twoimi
        zdjęciami.
      </p>
      <label
        className={`${ui.secondary} mt-3 inline-block cursor-pointer has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-brand-600`}
      >
        Wczytaj tablicę z pliku…
        <input
          type="file"
          accept=".obz,.obf,.zip,application/zip,application/json"
          className="sr-only"
          disabled={busy !== null}
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {imported && (
        <div className={`${item} mt-3`} data-testid="file-summary">
          <p className="font-semibold text-slate-900">
            „{imported.package.name}”: {sizeOf(imported)}
          </p>
          {imported.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm text-amber-900">
              {imported.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              className={ui.primary}
              disabled={busy !== null}
              onClick={() => {
                setPlaceProblem(null);
                setPlacing(true);
              }}
            >
              Dodaj…
            </button>
            <button
              type="button"
              className={ui.secondary}
              disabled={busy !== null}
              onClick={() => setImported(null)}
            >
              Anuluj
            </button>
          </div>
        </div>
      )}
      {busy && !placing && (
        <p role="status" className="mt-3 text-slate-700">
          {busy}
        </p>
      )}
      {imported && placing && (
        <PlacePicker
          name={imported.package.name}
          start={board}
          busy={busy}
          problem={placeProblem}
          onClose={() => setPlacing(false)}
          onPlace={(place) => void add(place)}
        />
      )}
    </section>
  );
}
