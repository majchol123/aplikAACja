import type { AdminUser, Me } from '@aplikaacja/shared';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import { AccountDialog } from './AccountDialog.tsx';
import { AuditLog } from './AuditLog.tsx';
import { BackupPanel } from './BackupPanel.tsx';
import { useAdminUsers } from './data.ts';
import {
  adminStats,
  formatAgo,
  formatBytes,
  formatCount,
  formatDate,
  lastActive,
  BOARDS_PL,
  PHOTOS_PL,
  ROLE_LABEL,
  TILES_PL,
  STATUS_LABEL,
  type AdminStats,
} from './format.ts';

type View = 'accounts' | 'audit' | 'backup';
type StatusFilter = 'all' | AdminUser['status'];

const card = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100 sm:p-6';

/** Admin panel (PLAN §2.6): accounts with statistics v1, the audit log, backups (superadmin). */
export function AdminScreen({ me, onBack }: { me: Me; onBack: () => void }) {
  const [view, setView] = useState<View>('accounts');
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-brand-100">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-bold tracking-tight text-brand-800">aplikAACja</span>
        <h1 className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
          Panel administratora
        </h1>
        <button
          type="button"
          onClick={onBack}
          className="ml-auto rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
        >
          Wróć do ustawień
        </button>
      </header>
      <nav className="mt-4 flex gap-2" aria-label="Części panelu">
        {(
          [
            ['accounts', 'Konta'],
            ['audit', 'Dziennik zdarzeń'],
            ...(me.role === 'superadmin' ? ([['backup', 'Kopie zapasowe']] as const) : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className="rounded-full border-2 border-brand-200 bg-white px-4 py-2 font-semibold text-brand-800 aria-pressed:border-brand-700 aria-pressed:bg-brand-700 aria-pressed:text-white"
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="mt-4 flex-1 space-y-4">
        {view === 'accounts' ? (
          <Accounts me={me} />
        ) : view === 'backup' ? (
          <BackupPanel />
        ) : (
          <section className={card} aria-labelledby="audit-title">
            <h2 id="audit-title" className="text-lg font-bold text-brand-900">
              Dziennik zdarzeń
            </h2>
            <p className="mt-1 text-slate-600">
              Wszystkie działania administratorów: kto, kiedy, na jakim koncie i co zmienił.
            </p>
            <AuditLog label="Dziennik zdarzeń" />
          </section>
        )}
      </main>
    </div>
  );
}

function Accounts({ me }: { me: Me }) {
  const id = useId();
  const users = useAdminUsers();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const deferred = useDeferredValue(query.trim().toLowerCase());

  const list = useMemo(() => users.data?.users ?? [], [users.data]);
  const stats = useMemo(() => adminStats(list), [list]);
  const shown = useMemo(
    () =>
      list.filter(
        (u) =>
          (status === 'all' || u.status === status) &&
          (!deferred ||
            u.email.toLowerCase().includes(deferred) ||
            (u.displayName ?? '').toLowerCase().includes(deferred)),
      ),
    [list, status, deferred],
  );
  // Looked up again on every change, so the dialog shows the account as it is now.
  const open = openId ? list.find((u) => u.id === openId) : undefined;

  if (users.isPending) {
    return (
      <p role="status" className="text-slate-600">
        Wczytywanie kont…
      </p>
    );
  }
  if (users.isError) {
    return (
      <div className={card}>
        <p role="alert" className="text-red-700">
          Nie udało się wczytać listy kont.
        </p>
        <button
          type="button"
          className={`${ui.secondary} mt-3`}
          onClick={() => void users.refetch()}
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  return (
    <>
      <Stats stats={stats} />
      <section className={card} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
          Konta
        </h2>
        {users.data.truncated && (
          <p className="mt-1 text-amber-800">
            Lista pokazuje {formatCount(list.length)} najnowszych kont.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor={`${id}-q`} className={ui.field}>
              Szukaj po adresie lub nazwie
            </label>
            <input
              id={`${id}-q`}
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={ui.input}
            />
          </div>
          <div>
            <label htmlFor={`${id}-status`} className={ui.field}>
              Stan
            </label>
            <select
              id={`${id}-status`}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base"
            >
              <option value="all">Wszystkie</option>
              <option value="active">{STATUS_LABEL.active}</option>
              <option value="blocked">{STATUS_LABEL.blocked}</option>
              <option value="deleting">{STATUS_LABEL.deleting}</option>
            </select>
          </div>
        </div>
        <div className="mt-4 hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 sm:block">
          <table className="w-full text-left text-sm" aria-label="Konta">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {[
                  'Konto',
                  'Rola',
                  'Stan',
                  'Założone',
                  'Ostatnia aktywność',
                  'Tablice',
                  'Kafelki',
                  'Zdjęcia',
                  'Miejsce',
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2 font-semibold ${i >= 5 ? 'text-right' : ''}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((u) => (
                <tr key={u.id} className="hover:bg-brand-50/50">
                  <td className="px-3 py-2">
                    <AccountButton user={u} me={me} onOpen={setOpenId} />
                    <div className="break-words text-slate-600">{u.email}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                    {ROLE_LABEL[u.role]}
                    {u.extraSet && <div className="text-slate-600">+ dodatkowy zestaw</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-800">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-800">
                    {formatAgo(lastActive(u))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(u.boards)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(u.tiles)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCount(u.media)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {formatBytes(u.storageBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Phones: one card per account instead of nine columns. */}
        <ul
          className="mt-4 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200 sm:hidden"
          aria-label="Konta"
        >
          {shown.map((u) => (
            <li key={u.id} className="px-3 py-3 text-sm">
              <AccountButton user={u} me={me} onOpen={setOpenId} />
              <div className="break-words text-slate-600">{u.email}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-800">
                <StatusBadge status={u.status} />
                <span>{ROLE_LABEL[u.role]}</span>
                {u.extraSet && <span className="text-slate-600">+ dodatkowy zestaw</span>}
              </div>
              <p className="mt-1 text-slate-700">
                Założone {formatDate(u.createdAt)}, aktywne {formatAgo(lastActive(u))}
              </p>
              <p className="text-slate-700">
                {[
                  countPl(u.boards, BOARDS_PL),
                  countPl(u.tiles, TILES_PL),
                  countPl(u.media, PHOTOS_PL),
                  formatBytes(u.storageBytes),
                ].join(', ')}
              </p>
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="mt-3 text-slate-600">Brak kont spełniających warunki.</p>
        )}
      </section>
      {open && <AccountDialog me={me} user={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

function AccountButton({
  user,
  me,
  onOpen,
}: {
  user: AdminUser;
  me: Me;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(user.id)}
      className="text-left font-semibold text-brand-800 underline underline-offset-2 hover:text-brand-900"
    >
      {user.displayName ?? user.email}
      {user.id === me.id && <span className="font-normal text-slate-600"> (Ty)</span>}
    </button>
  );
}

function StatusBadge({ status }: { status: AdminUser['status'] }) {
  const style =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : status === 'blocked'
        ? 'bg-red-50 text-red-800 ring-red-200'
        : 'bg-amber-50 text-amber-900 ring-amber-200';
  const mark = status === 'active' ? '●' : status === 'blocked' ? '⊘' : '…';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${style}`}
    >
      <span aria-hidden="true">{mark}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Statistics v1 as a row of figures (no series over time exist yet). */
function Stats({ stats }: { stats: AdminStats }) {
  const tiles: { label: string; value: string; note?: string }[] = [
    {
      label: 'Konta',
      value: formatCount(stats.accounts),
      note: `${formatCount(stats.active)} aktywnych, ${formatCount(stats.blocked)} zablokowanych`,
    },
    {
      label: 'Aktywne w ostatnich 7 dniach',
      value: formatCount(stats.activeWeek),
      note: `${formatCount(stats.activeMonth)} w ostatnich 30 dniach`,
    },
    { label: 'Nowe konta w ostatnich 30 dniach', value: formatCount(stats.newMonth) },
    { label: 'Z dodatkowym zestawem', value: formatCount(stats.extraSet) },
    {
      label: 'Tablice',
      value: formatCount(stats.boards),
      note: `${formatCount(stats.tiles)} kafelków`,
    },
    {
      label: 'Własne zdjęcia',
      value: formatCount(stats.media),
      note: `${formatBytes(stats.storageBytes)} miejsca`,
    },
  ];
  return (
    <section aria-labelledby="stats-title">
      <h2 id="stats-title" className="sr-only">
        Statystyki
      </h2>
      <ul
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
        data-testid="admin-stats"
      >
        {tiles.map((t) => (
          <li key={t.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100">
            <p className="text-sm text-slate-600">{t.label}</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{t.value}</p>
            {t.note && <p className="mt-1 text-sm text-slate-600">{t.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
