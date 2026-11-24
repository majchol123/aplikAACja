import type { Me } from '@aplikaacja/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { forgetHistory } from '../comm/phrases.ts';
import { forgetUsage } from '../comm/usage.ts';
import { ui } from '../edit/ui.ts';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';

/**
 * "Usuń konto" (PLAN §4.3): the account deletes itself, confirmed by typing its e-mail
 * address, as an admin's delete is. What waits on this device to be sent (history, usage
 * counts) is forgotten, not sent. A superadmin is told how instead: the role comes from
 * ADMIN_EMAILS, and the next sign-in would create the account again.
 */
export function DeleteAccountPanel({ me }: { me: Me }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const remove = useMutation({
    mutationFn: () => api('/api/me', { method: 'DELETE', json: { email } }),
    onSuccess: () => {
      forgetHistory();
      forgetUsage();
      location.assign('/?blad=usuniete');
    },
  });
  const matches = email.trim().toLowerCase() === me.email.toLowerCase();
  const error =
    remove.error instanceof ApiError && remove.error.code === 'confirmation_mismatch'
      ? 'Ten adres nie jest adresem tego konta.'
      : remove.error
        ? 'Nie udało się usunąć konta. Sprawdź połączenie i spróbuj ponownie.'
        : null;

  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Usuń konto
      </h2>
      <p className="mt-1 text-slate-600">
        Usuwa na zawsze konto i wszystko, co na nim jest, na wszystkich urządzeniach: tablice,
        zdjęcia, ustawienia, ulubione frazy, historię wypowiedzi i liczniki użycia. Tego nie da się
        cofnąć — jeśli tablice mają zostać, najpierw pobierz kopię danych (wyżej). Kopie tablic
        wysłane innym kontom zostają u odbiorców
        {me.role === 'admin' ? ', a tablice opublikowane w katalogu — w katalogu' : ''}. Z
        zaszyfrowanych kopii zapasowych dane konta znikną najpóźniej po 30 dniach.
      </p>
      {me.role === 'superadmin' ? (
        <p className="mt-3 text-slate-700">
          Konta superadministratora nie można usunąć w aplikacji: ta rola wynika z ustawień serwera
          (ADMIN_EMAILS). Najpierw trzeba usunąć stamtąd adres tego konta.
        </p>
      ) : !open ? (
        <button type="button" className={`mt-4 ${ui.danger}`} onClick={() => setOpen(true)}>
          Usuń konto…
        </button>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches) remove.mutate();
          }}
        >
          <label className={ui.field}>
            Aby potwierdzić, wpisz adres e-mail tego konta ({me.email})
            <input
              type="email"
              className={ui.input}
              value={email}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={ui.danger} disabled={!matches || remove.isPending}>
              {remove.isPending ? 'Usuwanie…' : 'Usuń konto na zawsze'}
            </button>
            <button
              type="button"
              className={ui.secondary}
              disabled={remove.isPending}
              onClick={() => {
                setOpen(false);
                setEmail('');
                remove.reset();
              }}
            >
              Anuluj
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
