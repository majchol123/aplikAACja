import {
  SHARE_SENT_MESSAGE,
  SHARED_HOME_NAME,
  subtreePackage,
  type Board,
  type BoardTree,
  type Me,
  type SymbolRef,
} from '@aplikaacja/shared';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { usePublish } from './catalog.ts';
import { shareProblem, useSendShare } from './data.ts';
import { download, exportBoardFile, FileProblem } from './files.ts';

const section = 'mt-5 border-t border-slate-200 pt-4';

/**
 * Copies of a board going out (PLAN §2.8): to another account, to an Open Board file,
 * and — for admins — to the catalogue of public boards.
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
      {(me.role === 'admin' || me.role === 'superadmin') && (
        <PublishSection tree={tree} board={board} />
      )}
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
          Osoba bez dostępu do dodatkowego zestawu zobaczy zamiast jego symboli podobne symbole
          ARASAAC, dobrane po napisie.
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
          Adres e-mail konta odbiorcy w aplikAACja
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setError(null);
    setMessage(null);
    setBusy(true);
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
      setError(err instanceof FileProblem ? err.message : shareProblem(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Plik Open Board (.obz)
      </h3>
      <p className="mt-1 text-slate-700">
        Kopia tablicy z folderami i obrazkami w jednym pliku, który otworzą też inne aplikacje AAC.
        Symbole dodatkowego zestawu zapisują się bez obrazków (aplikAACja pokaże w ich miejscu
        podobne symbole ARASAAC). Plik wczytasz przyciskiem „Dodaj tablicę”.
      </p>
      <button
        type="button"
        className={`${ui.secondary} mt-3`}
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? 'Przygotowywanie pliku…' : 'Zapisz tę tablicę do pliku'}
      </button>
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

/** Admins: a copy of this board for every account (PLAN §2.8), photos only by consent. */
function PublishSection({ tree, board }: { tree: BoardTree; board: Board }) {
  const id = useId();
  const publish = usePublish();
  // A pulpit travels as "Udostępnione", like when it is sent (subtreePackage).
  const [name, setName] = useState(board.parentId === null ? SHARED_HOME_NAME : board.name);
  const [description, setDescription] = useState('');
  const [withPhotos, setWithPhotos] = useState(false);
  const photos = useMemo(() => {
    const boards = new Map(tree.boards.map((b) => [b.id, b]));
    return subtreePackage(boards, board.id)?.photoIds.length ?? 0;
  }, [tree.boards, board.id]);

  return (
    <section className={section} aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="font-bold text-brand-900">
        Katalog tablic publicznych
      </h3>
      <p className="mt-1 text-slate-700">
        Kopia tej tablicy z folderami trafi do katalogu, z którego każde zalogowane konto może ją
        dodać do swoich tablic. Zmiany tej tablicy nie zmieniają kopii w katalogu.
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          publish.mutate({
            boardId: board.id,
            name: name.trim(),
            description: description.trim(),
            includePhotos: withPhotos,
          });
        }}
      >
        <label className={ui.field} htmlFor={`${id}-name`}>
          Nazwa w katalogu
        </label>
        <input
          id={`${id}-name`}
          value={name}
          required
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={ui.input}
        />
        <label className={ui.field} htmlFor={`${id}-description`}>
          Opis (dla kogo, do czego)
        </label>
        <textarea
          id={`${id}-description`}
          value={description}
          rows={3}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          className={ui.input}
        />
        {photos > 0 && (
          <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-slate-800 ring-1 ring-amber-200">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={withPhotos}
              onChange={(e) => setWithPhotos(e.target.checked)}
            />
            <span>
              Dołącz moje zdjęcia ({photos}). Zobaczy je każdy, kto otworzy katalog. Bez zgody
              kafelki ze zdjęciami trafią do katalogu z samym napisem.
            </span>
          </label>
        )}
        <button type="submit" className={ui.primary} disabled={publish.isPending || !name.trim()}>
          {publish.isPending ? 'Publikowanie…' : 'Opublikuj w katalogu'}
        </button>
      </form>
      {publish.isSuccess && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200"
        >
          Opublikowano „{publish.data.name}” w katalogu.
        </p>
      )}
      {publish.isError && (
        <p role="alert" className="mt-3 text-red-700">
          {shareProblem(publish.error)}
        </p>
      )}
    </section>
  );
}
