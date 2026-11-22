import {
  SHARE_SENT_MESSAGE,
  treeShape,
  type Board,
  type BoardTree,
  type Me,
  type ObzImport,
  type SymbolRef,
} from '@relaacja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { BOARDS_PL, PHOTOS_PL, TILES_PL } from '../admin/format.ts';
import { applyChanges, TREE_KEY } from '../boards/data.ts';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { MEDIA_KEY } from '../media/data.ts';
import { shareProblem, useSendShare } from './data.ts';
import { download, exportBoardFile, FileProblem, importBoardFile, readBoardFile } from './files.ts';

const section = 'mt-5 border-t border-slate-200 pt-4';

/**
 * Copies of a board (PLAN §2.8): sent to another account, saved to an Open Board file, or
 * a board read from such a file and added here.
 */
export function ShareDialog({
  me,
  tree,
  board,
  resolve,
  onClose,
}: {
  me: Me;
  tree: BoardTree;
  board: Board;
  resolve: (symbol: SymbolRef) => string | null;
  onClose: () => void;
}) {
  return (
    <Dialog title={`Udostępnij tablicę „${board.name}”`} onClose={onClose} wide>
      <SendSection me={me} board={board} />
      <FileSection tree={tree} board={board} resolve={resolve} />
      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}

/** The answer is the same whether that address has an account or not. */
function SendSection({ me, board }: { me: Me; board: Board }) {
  const id = useId();
  const send = useSendShare();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const address = email.trim();

  return (
    <section className="mt-3" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Wyślij kopię innemu kontu
      </h3>
      <p className="mt-1 text-slate-700">
        Wyślesz kopię tej tablicy razem z jej folderami i zdjęciami. Odbiorca zobaczy Twoje imię i
        adres e-mail ({me.email}) i sam zdecyduje, czy ją przyjąć. Twoja tablica się nie zmieni.
      </p>
      {me.extraSet && (
        <p className="mt-1 text-sm text-slate-600">
          Symbole dodatkowego zestawu osoba bez dostępu do niego zobaczy jako sam napis.
        </p>
      )}
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!address) return;
          setSentTo(null);
          send.mutate(
            { boardId: board.id, email: address },
            {
              onSuccess: () => {
                setSentTo(address);
                setEmail('');
              },
            },
          );
        }}
      >
        <label htmlFor={`${id}-email`} className={ui.field}>
          Adres e-mail konta odbiorcy w relAACja
        </label>
        <div className="mt-1 flex flex-wrap gap-3">
          <input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={320}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${ui.input} mt-0 min-w-0 flex-1 basis-64`}
          />
          <button type="submit" className={ui.primary} disabled={!address || send.isPending}>
            {send.isPending ? 'Wysyłanie…' : 'Wyślij'}
          </button>
        </div>
      </form>
      {sentTo && (
        <div
          role="status"
          className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200"
        >
          <p className="font-semibold">Wysłano na adres {sentTo}.</p>
          <p className="mt-1">{SHARE_SENT_MESSAGE}</p>
          <p className="mt-1 text-sm">
            Gdy odbiorca zdecyduje, zobaczysz to w Ustawieniach, w części „Udostępnione tablice”.
          </p>
        </div>
      )}
      {send.isError && (
        <p role="alert" className="mt-3 text-red-700">
          {shareProblem(send.error)}
        </p>
      )}
    </section>
  );
}

function sizeOf(imported: ObzImport): string {
  const shape = treeShape(imported.package.board, imported.package.name, { allowOwn: true });
  const parts = [countPl(shape.boards, BOARDS_PL), countPl(shape.tiles, TILES_PL)];
  if (imported.photos.length) parts.push(countPl(imported.photos.length, PHOTOS_PL));
  return parts.join(', ');
}

function problem(err: unknown): string {
  if (err instanceof FileProblem) return err.message;
  return shareProblem(err);
}

function FileSection({
  tree,
  board,
  resolve,
}: {
  tree: BoardTree;
  board: Board;
  resolve: (symbol: SymbolRef) => string | null;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ObzImport | null>(null);

  async function save(): Promise<void> {
    setError(null);
    setMessage(null);
    setBusy('Przygotowywanie pliku…');
    try {
      const file = await exportBoardFile(tree, board.id, resolve);
      download(file.blob, file.name);
      setMessage(
        `Zapisano plik ${file.name}.` +
          (file.missing
            ? ` ${countPl(file.missing, ['obrazka', 'obrazków', 'obrazków'])} nie udało się pobrać.`
            : ''),
      );
    } catch (err) {
      setError(problem(err));
    } finally {
      setBusy(null);
    }
  }

  async function read(file: File | undefined): Promise<void> {
    setError(null);
    setMessage(null);
    setImported(null);
    if (!file) return;
    setBusy('Odczytywanie pliku…');
    try {
      setImported(await readBoardFile(file));
    } catch (err) {
      setError(problem(err));
    } finally {
      setBusy(null);
    }
  }

  async function add(): Promise<void> {
    if (!imported) return;
    setError(null);
    try {
      const { changes, skippedPhotos } = await importBoardFile(imported, board, (done, total) =>
        setBusy(total ? `Wysyłanie zdjęć: ${done} z ${total}…` : 'Dodawanie tablicy…'),
      );
      applyChanges(queryClient, changes);
      setMessage(
        `Dodano folder „${imported.package.name}” na tablicy „${board.name}”.` +
          (skippedPhotos
            ? ` Pominięto zdjęcia, których nie dało się odczytać: ${skippedPhotos}.`
            : ''),
      );
      setImported(null);
    } catch (err) {
      setError(problem(err));
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
    } finally {
      void queryClient.invalidateQueries({ queryKey: MEDIA_KEY });
      setBusy(null);
    }
  }

  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Plik Open Board (.obz)
      </h3>
      <p className="mt-1 text-slate-700">
        Kopia tablicy z folderami i obrazkami w jednym pliku, który otworzą też inne aplikacje AAC.
        Symbole dodatkowego zestawu zapisują się bez obrazków.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={ui.secondary}
          disabled={busy !== null}
          onClick={() => void save()}
        >
          Zapisz tę tablicę do pliku
        </button>
        <label
          className={`${ui.secondary} cursor-pointer has-disabled:opacity-50 has-focus-visible:ring-2 has-focus-visible:ring-brand-600`}
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
      </div>
      {imported && (
        <div
          className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
          data-testid="file-summary"
        >
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
              onClick={() => void add()}
            >
              Dodaj na tablicę „{board.name}”
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
      {busy && (
        <p role="status" className="mt-3 text-slate-700">
          {busy}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200"
        >
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
