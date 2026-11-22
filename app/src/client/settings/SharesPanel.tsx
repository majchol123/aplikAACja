import type { SentShare } from '@relaacja/shared';
import { useId } from 'react';
import { formatDate } from '../admin/format.ts';
import { shareProblem, useRemoveSent, useShares } from '../shares/data.ts';
import { senderLabel, shareSize } from '../shares/AddBoardDialog.tsx';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';

function status(share: SentShare): string {
  switch (share.status) {
    case 'pending':
      return `czeka na decyzję (do ${formatDate(share.expiresAt)})`;
    case 'accepted':
      return `przyjęta ${formatDate(share.decidedAt)}`;
    case 'rejected':
      return `odrzucona ${formatDate(share.decidedAt)}`;
    case 'expired':
      return 'bez decyzji — wygasła';
  }
}

/** Boards sent to and received from other accounts (PLAN §2.8). */
export function SharesPanel() {
  const id = useId();
  const shares = useShares({ fresh: true });
  const remove = useRemoveSent();
  const received = shares.data?.received ?? [];
  const sent = shares.data?.sent ?? [];

  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Udostępnione tablice
      </h2>
      <p className="mt-1 text-slate-600">
        Kopię tablicy wysyłasz (albo zapisujesz do pliku) w trybie edycji przyciskiem „Udostępnij”.
        Otrzymane tablice dodajesz tam przyciskiem „Dodaj tablicę”, na tablicy, na której mają się
        pojawić.
      </p>

      <h3 className="mt-4 font-semibold text-slate-800">Otrzymane</h3>
      {received.length === 0 ? (
        <p className="mt-1 text-slate-600">Nie ma otrzymanych tablic.</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
          {received.map((share) => (
            <li key={share.id}>
              <span className="font-semibold">{share.name}</span> od {senderLabel(share)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 font-semibold text-slate-800">Wysłane</h3>
      {sent.length === 0 ? (
        <p className="mt-1 text-slate-600">Nie wysłano jeszcze żadnej tablicy.</p>
      ) : (
        <ul
          className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200"
          aria-label="Wysłane tablice"
        >
          {sent.map((share) => (
            <li key={share.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900">
                  {share.name}{' '}
                  <span className="font-normal text-slate-600">→ {share.recipient}</span>
                </p>
                <p className="text-sm text-slate-600">
                  Wysłana {formatDate(share.createdAt)}: {status(share)}. {shareSize(share)}.
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-brand-800 underline underline-offset-2"
                disabled={remove.isPending}
                onClick={() => remove.mutate(share.id)}
              >
                Usuń z listy
              </button>
            </li>
          ))}
        </ul>
      )}
      {(shares.isError || remove.isError) && (
        <p role="alert" className="mt-3 text-red-700">
          {shareProblem(shares.error ?? remove.error)}
        </p>
      )}
    </section>
  );
}
