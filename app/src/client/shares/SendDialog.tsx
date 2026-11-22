import { SHARE_SENT_MESSAGE, type Board, type Me } from '@relaacja/shared';
import { useId, useState } from 'react';
import { Dialog } from '../edit/Dialog.tsx';
import { ui } from '../edit/ui.ts';
import { shareProblem, useSendShare } from './data.ts';

/**
 * Sends a copy of a board with its folders and photos to another account (PLAN §2.8). The
 * answer is the same whether that address has an account or not.
 */
export function SendDialog({ me, board, onClose }: { me: Me; board: Board; onClose: () => void }) {
  const id = useId();
  const send = useSendShare();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const address = email.trim();

  return (
    <Dialog title={`Wyślij kopię tablicy „${board.name}”`} onClose={onClose}>
      <p className="mt-3 text-slate-700">
        Wyślesz kopię tej tablicy razem z jej folderami i zdjęciami. Odbiorca zobaczy Twoje imię i
        adres e-mail ({me.email}) i sam zdecyduje, czy ją przyjąć. Twoja tablica się nie zmieni.
      </p>
      {me.extraSet && (
        <p className="mt-2 text-sm text-slate-600">
          Symbole dodatkowego zestawu osoba bez dostępu do niego zobaczy jako sam napis.
        </p>
      )}
      <form
        className="mt-4"
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
          className={ui.input}
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" className={ui.primary} disabled={!address || send.isPending}>
            {send.isPending ? 'Wysyłanie…' : 'Wyślij'}
          </button>
          <button type="button" className={ui.secondary} onClick={onClose}>
            Zamknij
          </button>
        </div>
      </form>
      {sentTo && (
        <div
          role="status"
          className="mt-4 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200"
        >
          <p className="font-semibold">Wysłano na adres {sentTo}.</p>
          <p className="mt-1">{SHARE_SENT_MESSAGE}</p>
          <p className="mt-1 text-sm">
            Gdy odbiorca zdecyduje, zobaczysz to w Ustawieniach, w części „Udostępnione tablice”.
          </p>
        </div>
      )}
      {send.isError && (
        <p role="alert" className="mt-4 text-red-700">
          {shareProblem(send.error)}
        </p>
      )}
    </Dialog>
  );
}
