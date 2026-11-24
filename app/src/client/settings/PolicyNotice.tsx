import { POLICY_VERSION } from '@aplikaacja/shared';
import { useAccountSettings, useUpdateAccountSettings } from './account.ts';

/**
 * The one-time notice of a notable privacy-policy change (the policy promises it), shown
 * where the account is looked after (edit mode, settings), not in communication mode.
 */
export function PolicyNotice() {
  const settings = useAccountSettings();
  const update = useUpdateAccountSettings();
  if (!settings.data || settings.data.policyNotice >= POLICY_VERSION) return null;
  return (
    <section
      aria-label="Zmiana polityki prywatności"
      className="flex flex-wrap items-center gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sky-950 ring-1 ring-sky-200"
    >
      <p className="min-w-0 flex-1">
        <strong>Zmiana polityki prywatności (24.11.2026):</strong> aplikacja liczy, ile zdań i
        kafelków dziennie użyto na koncie — same liczby, bez słów i bez tego, które to kafelki —
        żeby administrator wiedział, czy i jak bardzo aplikacja się przydaje. Liczniki można
        wyłączyć w Ustawieniach („Liczniki użycia dla administratora”); wyłączenie je usuwa. Konto
        można teraz też usunąć samodzielnie: Ustawienia → „Usuń konto”.{' '}
        <a className="font-semibold underline" href="/prywatnosc">
          Polityka prywatności
        </a>
      </p>
      <button
        type="button"
        className="rounded-full bg-sky-800 px-4 py-2 font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
        disabled={update.isPending}
        onClick={() => update.mutate({ policyNotice: POLICY_VERSION })}
      >
        Rozumiem
      </button>
    </section>
  );
}
