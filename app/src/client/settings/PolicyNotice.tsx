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
        <strong>Zmiana polityki prywatności (23.11.2026):</strong> ostatnie wypowiedzi (do 50)
        zapisują się teraz na koncie, więc historia jest taka sama na każdym urządzeniu. Można ją
        wyłączyć w Ustawieniach („Zapisuj historię wypowiedzi”). Dane kont mają też zaszyfrowane
        kopie zapasowe, przechowywane na terenie UE do 30 dni.{' '}
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
