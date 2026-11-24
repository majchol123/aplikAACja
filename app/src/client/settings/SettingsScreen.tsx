import type { Me } from '@aplikaacja/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { forgetHistory, sendHistoryNow } from '../comm/phrases.ts';
import { forgetUsage, sendUsageNow } from '../comm/usage.ts';
import { Library } from '../library/Library.tsx';
import { DeleteAccountPanel } from './DeleteAccountPanel.tsx';
import { DevicePanel } from './DevicePanel.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { LockPanel } from './LockPanel.tsx';
import { PhotosPanel } from './PhotosPanel.tsx';
import { PolicyNotice } from './PolicyNotice.tsx';
import { SharesPanel } from './SharesPanel.tsx';

function goHome(): void {
  forgetHistory();
  forgetUsage();
  location.assign('/');
}

/** Settings, symbol library and account; reached from edit mode (PLAN §2.2). */
export function SettingsScreen({
  me,
  backLabel,
  onBack,
  onAdmin,
}: {
  me: Me;
  backLabel: string;
  onBack: () => void;
  onAdmin: () => void;
}) {
  const isAdmin = me.role === 'admin' || me.role === 'superadmin';
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: async () => {
      await Promise.all([sendHistoryNow(me.id, queryClient), sendUsageNow(me.id)]);
      return api('/api/auth/logout', { method: 'POST' });
    },
    onSettled: goHome,
  });
  const logoutAll = useMutation({
    mutationFn: async () => {
      await Promise.all([sendHistoryNow(me.id, queryClient), sendUsageNow(me.id)]);
      return api('/api/auth/logout-all', { method: 'POST' });
    },
    onSettled: goHome,
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-brand-100">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-bold tracking-tight text-brand-800">aplikAACja</span>
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
        <PolicyNotice />
        <DevicePanel />
        <LockPanel />
        <Library me={me} />
        <PhotosPanel />
        <SharesPanel />
        <ExportPanel me={me} />

        {isAdmin && (
          <section
            className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100"
            data-testid="admin-summary"
          >
            <h2 className="text-lg font-bold text-brand-900">
              {me.role === 'superadmin' ? 'Superadministrator' : 'Administrator'}
            </h2>
            <p className="mt-1 text-slate-600">
              Konta, blokady, dodatkowy zestaw, statystyki i dziennik zdarzeń.
            </p>
            <button
              type="button"
              onClick={onAdmin}
              className="mt-4 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
            >
              Otwórz panel administratora
            </button>
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

        <DeleteAccountPanel me={me} />
      </main>

      <footer className="mt-8 pb-2 text-center text-sm text-slate-500">
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <a href="/pomoc" className="underline underline-offset-2">
            Pomoc
          </a>
          <a href="/prywatnosc" className="underline underline-offset-2">
            Polityka prywatności
          </a>
          <a href="/o-aplikacji" className="underline underline-offset-2">
            O aplikacji
          </a>
        </nav>
      </footer>
    </div>
  );
}
