import { RESTORE_MARGIN_MS, RESTORE_WINDOW_MS, type AdminUser } from '@relaacja/shared';
import { useId, useState } from 'react';
import { ui } from '../edit/ui.ts';
import { adminProblem, useRestoreUser } from './data.ts';
import { formatDateTime } from './format.ts';

const HOUR_MS = 3600 * 1000;

/** `ms` as the local "YYYY-MM-DDTHH:mm" of a datetime-local field. */
function localInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Point-in-time recovery of one account (superadmins, PLAN §6): its boards, photos and
 * settings go back to a chosen moment of the last 30 days. Confirmed by typing the e-mail.
 */
export function RestorePanel({ user }: { user: AdminUser }) {
  const id = useId();
  const restore = useRestoreUser();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<number | null>(null);
  /** When the form opened: the window of 30 days is counted from then. */
  const [openedAt, setOpenedAt] = useState(0);

  const at = when ? new Date(when).getTime() : NaN;
  // Before the account existed there is only an empty vault to go back to.
  const oldest = Math.max(openedAt - RESTORE_WINDOW_MS + RESTORE_MARGIN_MS, user.createdAt);
  const inRange = at < openedAt && at >= oldest;
  const typedOk = typed.trim().toLowerCase() === user.email.toLowerCase();

  const close = () => {
    setOpen(false);
    setTyped('');
    restore.reset();
  };

  return (
    <>
      <p className="mt-1 text-slate-700">
        Cofa tablice, zdjęcia, ustawienia, ulubione frazy i historię wypowiedzi do wybranej chwili z
        ostatnich 30 dni. Zmiany wprowadzone później znikną. Konto, rola i logowania zostają bez
        zmian.
      </p>
      {done !== null && (
        <p role="status" className="mt-2 text-emerald-800">
          Przywrócono stan z {formatDateTime(done)}. Pomyłkę cofniesz, przywracając stan sprzed tej
          operacji (jej godzina jest w historii konta poniżej).
        </p>
      )}
      {!open ? (
        <button
          type="button"
          className={`${ui.secondary} mt-3`}
          onClick={() => {
            const now = Date.now();
            setOpenedAt(now);
            setWhen(localInput(Math.max(now - HOUR_MS, user.createdAt + 60_000)));
            setDone(null);
            setOpen(true);
          }}
        >
          Przywróć wcześniejszy stan…
        </button>
      ) : (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!inRange || !typedOk) return;
            restore.mutate(
              { id: user.id, at, email: typed },
              {
                onSuccess: () => {
                  setDone(at);
                  close();
                },
              },
            );
          }}
        >
          <label htmlFor={`${id}-when`} className={ui.field}>
            Stan z chwili
          </label>
          <input
            id={`${id}-when`}
            type="datetime-local"
            value={when}
            min={localInput(oldest + 60_000)}
            max={localInput(openedAt)}
            onChange={(e) => setWhen(e.target.value)}
            className={ui.input}
            aria-describedby={`${id}-when-hint`}
          />
          <p id={`${id}-when-hint`} className="mt-1 text-sm text-slate-600">
            {when && !inRange
              ? `Wybierz chwilę między ${formatDateTime(oldest)} a teraz.`
              : 'Czas lokalny tego urządzenia.'}
          </p>
          <label htmlFor={`${id}-email`} className={`${ui.field} mt-3`}>
            Wpisz adres e-mail konta ({user.email}), aby potwierdzić
          </label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={ui.input}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="submit"
              className={ui.danger}
              disabled={!inRange || !typedOk || restore.isPending}
            >
              {restore.isPending
                ? 'Przywracanie…'
                : inRange
                  ? `Przywróć stan z ${formatDateTime(at)}`
                  : 'Przywróć stan'}
            </button>
            <button type="button" className={ui.secondary} onClick={close}>
              Anuluj
            </button>
          </div>
          {restore.isError && (
            <p role="alert" className="mt-3 text-red-700">
              {adminProblem(restore.error)}
            </p>
          )}
        </form>
      )}
    </>
  );
}
