import {
  canManage,
  canRestore,
  canSetExtraSet,
  canSetRole,
  type AdminUser,
  type Me,
} from '@aplikaacja/shared';
import { useId, useState } from 'react';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { AuditLog } from './AuditLog.tsx';
import { adminProblem, useAdminAction, useDeleteUser, type AdminAction } from './data.ts';
import { DataPreview } from './DataPreview.tsx';
import { RestorePanel } from './RestorePanel.tsx';
import {
  formatAgo,
  formatBytes,
  formatDateTime,
  lastActive,
  BOARDS_PL,
  PHOTOS_PL,
  ROLE_LABEL,
  TILES_PL,
  STATUS_LABEL,
} from './format.ts';

const section = 'mt-5 border-t border-slate-200 pt-4';

/** Why the actions are missing, when they are. */
function whyLocked(me: Me, user: AdminUser, extra: boolean): string {
  if (me.id === user.id) {
    return extra
      ? 'To Twoje konto: możesz tu tylko włączyć lub wyłączyć sobie dodatkowy zestaw.'
      : 'To Twoje konto. Zmienia je inny administrator.';
  }
  if (user.role === 'superadmin') {
    return 'Konto superadministratora wynika z konfiguracji serwera i nie zmienia się w aplikacji.';
  }
  return 'Konta administratorów zmienia tylko superadministrator.';
}

/** One account: facts, actions, data view and its history (PLAN §2.6). */
export function AccountDialog({
  me,
  user,
  onClose,
}: {
  me: Me;
  user: AdminUser;
  onClose: () => void;
}) {
  const id = useId();
  const action = useAdminAction();
  const remove = useDeleteUser();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState(false);

  const self = { id: me.id, role: me.role, extraSet: me.extraSet };
  const manage = canManage(self, user);
  const extra = canSetExtraSet(self, user);
  const role = canSetRole(self, user);
  const gone = user.status === 'deleting';
  const busy = action.isPending || remove.isPending;
  const run = (a: AdminAction) => action.mutate(a, { onSuccess: () => setConfirmBlock(false) });
  const typedOk = typed.trim().toLowerCase() === user.email.toLowerCase();

  const facts: [string, string][] = [
    ['E-mail', user.email],
    ['Rola', ROLE_LABEL[user.role]],
    [
      'Stan',
      user.status === 'blocked' && user.blockedAt
        ? `${STATUS_LABEL.blocked} od ${formatDateTime(user.blockedAt)}`
        : STATUS_LABEL[user.status],
    ],
    ['Dodatkowy zestaw', user.extraSet ? 'włączony' : 'wyłączony'],
    ['Założone', formatDateTime(user.createdAt)],
    ['Ostatnie logowanie', formatDateTime(user.lastLoginAt)],
    ['Ostatnia aktywność', `${formatAgo(lastActive(user))} (${formatDateTime(lastActive(user))})`],
    [
      'Zawartość',
      [
        countPl(user.boards, BOARDS_PL),
        countPl(user.tiles, TILES_PL),
        countPl(user.media, PHOTOS_PL),
      ].join(', '),
    ],
    ['Zajęte miejsce', formatBytes(user.storageBytes)],
  ];

  return (
    <Dialog title={user.displayName ?? user.email} onClose={onClose} wide>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="font-medium text-slate-600">{term}</dt>
            <dd className="break-words text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-slate-600">
        Liczby z ostatniego zapisu lub otwarcia tablic przez to konto.
      </p>

      <section className={section} aria-labelledby={`${id}-actions`}>
        <h3 id={`${id}-actions`} className="font-bold text-brand-900">
          Działania
        </h3>
        {gone ? (
          <p className="mt-2 text-slate-700">
            Usuwanie tego konta zostało przerwane. Dokończ je poniżej.
          </p>
        ) : (
          <>
            {!manage && <p className="mt-2 text-slate-700">{whyLocked(me, user, extra)}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {manage && user.status === 'active' && !confirmBlock && (
                <button
                  type="button"
                  className={ui.secondary}
                  disabled={busy}
                  onClick={() => setConfirmBlock(true)}
                >
                  Zablokuj konto
                </button>
              )}
              {manage && user.status === 'blocked' && (
                <button
                  type="button"
                  className={ui.secondary}
                  disabled={busy}
                  onClick={() => run({ kind: 'unblock', id: user.id })}
                >
                  Odblokuj konto
                </button>
              )}
              {extra && (
                <button
                  type="button"
                  className={ui.secondary}
                  disabled={busy}
                  onClick={() =>
                    run({ kind: 'extra-set', id: user.id, body: { enabled: !user.extraSet } })
                  }
                >
                  {user.extraSet ? 'Wyłącz dodatkowy zestaw' : 'Włącz dodatkowy zestaw'}
                </button>
              )}
              {role && (
                <button
                  type="button"
                  className={ui.secondary}
                  disabled={busy}
                  onClick={() =>
                    run({
                      kind: 'role',
                      id: user.id,
                      body: { role: user.role === 'admin' ? 'user' : 'admin' },
                    })
                  }
                >
                  {user.role === 'admin'
                    ? 'Odbierz rolę administratora'
                    : 'Nadaj rolę administratora'}
                </button>
              )}
            </div>
            {confirmBlock && (
              <div
                className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200"
                role="group"
                aria-label="Potwierdzenie blokady"
              >
                <p className="text-slate-800">
                  Zablokowane konto zostanie wylogowane ze wszystkich urządzeń i nie zaloguje się
                  ponownie, dopóki go nie odblokujesz. Tablice i zdjęcia zostają.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={ui.danger}
                    disabled={busy}
                    onClick={() => run({ kind: 'block', id: user.id })}
                  >
                    Tak, zablokuj
                  </button>
                  <button
                    type="button"
                    className={ui.secondary}
                    onClick={() => setConfirmBlock(false)}
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {action.isError && (
          <p role="alert" className="mt-3 text-red-700">
            {adminProblem(action.error)}
          </p>
        )}
      </section>

      {manage && !gone && (
        <section className={section} aria-labelledby={`${id}-data`}>
          <h3 id={`${id}-data`} className="font-bold text-brand-900">
            Dane konta
          </h3>
          {preview ? (
            <DataPreview me={me} user={user} />
          ) : (
            <>
              <p className="mt-1 text-slate-700">
                Tablice, zdjęcia i ustawienia, tylko do odczytu. Każde otwarcie zapisuje się w
                dzienniku zdarzeń.
              </p>
              <button
                type="button"
                className={`${ui.secondary} mt-3`}
                onClick={() => setPreview(true)}
              >
                Pokaż dane konta
              </button>
            </>
          )}
        </section>
      )}

      {canRestore(self, user) && !gone && (
        <section className={section} aria-labelledby={`${id}-restore`}>
          <h3 id={`${id}-restore`} className="font-bold text-brand-900">
            Wcześniejszy stan konta
          </h3>
          <RestorePanel user={user} />
        </section>
      )}

      {manage && (
        <section className={section} aria-labelledby={`${id}-delete`}>
          <h3 id={`${id}-delete`} className="font-bold text-red-800">
            Usunięcie konta
          </h3>
          {!deleting ? (
            <>
              <p className="mt-1 text-slate-700">
                Usuwa na zawsze konto, wszystkie jego tablice, zdjęcia i ustawienia. Tego nie da się
                cofnąć.
              </p>
              <button
                type="button"
                className={`${ui.danger} mt-3`}
                onClick={() => setDeleting(true)}
              >
                {gone ? 'Dokończ usuwanie' : 'Usuń konto…'}
              </button>
            </>
          ) : (
            <form
              className="mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typedOk) remove.mutate({ id: user.id, email: typed }, { onSuccess: onClose });
              }}
            >
              <label htmlFor={`${id}-email`} className={ui.field}>
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
                <button type="submit" className={ui.danger} disabled={!typedOk || busy}>
                  {remove.isPending ? 'Usuwanie…' : 'Usuń konto i wszystkie dane'}
                </button>
                <button
                  type="button"
                  className={ui.secondary}
                  onClick={() => {
                    setDeleting(false);
                    setTyped('');
                  }}
                >
                  Anuluj
                </button>
              </div>
              {remove.isError && (
                <p role="alert" className="mt-3 text-red-700">
                  {adminProblem(remove.error)}
                </p>
              )}
            </form>
          )}
        </section>
      )}

      <section className={section} aria-labelledby={`${id}-history`}>
        <h3 id={`${id}-history`} className="font-bold text-brand-900">
          Historia działań administratorów
        </h3>
        <AuditLog target={user.id} label={`Historia konta ${user.email}`} />
      </section>

      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}
