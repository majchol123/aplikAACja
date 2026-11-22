import type { AdminUser, Me } from '@relaacja/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Library } from '../library/Library.tsx';
import { DevicePanel } from './DevicePanel.tsx';
import { LockPanel } from './LockPanel.tsx';
import { PhotosPanel } from './PhotosPanel.tsx';

function goHome(): void {
  location.assign('/');
}

/** Settings, symbol library and account; reached from edit mode (PLAN §2.2). */
export function SettingsScreen({
  me,
  backLabel,
  onBack,
}: {
  me: Me;
  backLabel: string;
  onBack: () => void;
}) {
  const isAdmin = me.role === 'admin' || me.role === 'superadmin';
  const logout = useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSettled: goHome,
  });
  const logoutAll = useMutation({
    mutationFn: () => api('/api/auth/logout-all', { method: 'POST' }),
    onSettled: goHome,
  });
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<{ users: AdminUser[] }>('/api/admin/users'),
    enabled: isAdmin,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-brand-100">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-bold tracking-tight text-brand-800">relAACja</span>
        <h1 className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
          Ustawienia
        </h1>
        <span className="ml-auto truncate text-sm text-slate-600" data-testid="user-name">
          {me.displayName ?? me.email}
        </span>
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
        >
          {backLabel}
        </button>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="rounded-full border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
        >
          Wyloguj
        </button>
      </header>

      <main className="mt-6 flex-1 space-y-6">
        <DevicePanel />
        <LockPanel />
        <Library me={me} />
        <PhotosPanel />

        {isAdmin && (
          <section
            className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100"
            data-testid="admin-summary"
          >
            <h2 className="text-lg font-bold text-brand-900">
              {me.role === 'superadmin' ? 'Superadministrator' : 'Administrator'}
            </h2>
            <p className="mt-1 text-slate-600">
              Liczba kont: {users.data ? users.data.users.length : users.isError ? 'błąd' : '…'}
            </p>
          </section>
        )}

        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100">
          <h2 className="text-lg font-bold text-brand-900">Bezpieczeństwo</h2>
          <p className="mt-1 text-slate-600">
            Wylogowuje to konto na wszystkich tabletach, telefonach i komputerach.
          </p>
          <button
            type="button"
            onClick={() => logoutAll.mutate()}
            className="mt-4 rounded-full border border-brand-700 px-4 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
          >
            Wyloguj ze wszystkich urządzeń
          </button>
        </section>
      </main>

      <footer className="mt-8 pb-2 text-center text-sm text-slate-500">
        <a href="/prywatnosc" className="underline underline-offset-2">
          Polityka prywatności
        </a>
      </footer>
    </div>
  );
}
