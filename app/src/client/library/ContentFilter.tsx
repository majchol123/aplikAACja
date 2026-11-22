import { DEFAULT_SETTINGS, type Settings } from '@relaacja/shared';
import { useState } from 'react';
import { useAccountSettings, useUpdateAccountSettings } from '../settings/account.ts';

type Filter = Settings['contentFilter'];

const OPTIONS: { key: keyof Filter; label: string }[] = [
  {
    key: 'hideSexual',
    label: 'Ukrywaj symbole o seksualności (np. części intymne, miesiączka, antykoncepcja)',
  },
  { key: 'hideViolence', label: 'Ukrywaj symbole przemocy (np. bić, kopać, szczypać)' },
];

/**
 * Content filter of the account (PLAN §3.3). Both switches share one draft and one request:
 * the setting is a single object, so two quick clicks must not overwrite each other.
 */
export function ContentFilter() {
  const settings = useAccountSettings();
  const update = useUpdateAccountSettings();
  const [pending, setPending] = useState<Filter | null>(null);
  const current = pending ?? settings.data?.contentFilter ?? DEFAULT_SETTINGS.contentFilter;

  return (
    <fieldset className="mt-4" disabled={!settings.data || update.isPending}>
      <legend className="text-sm font-medium text-slate-700">Filtr treści</legend>
      {OPTIONS.map(({ key, label }) => (
        <label key={key} className="mt-2 flex items-center gap-3 text-slate-700">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-brand-700"
            checked={current[key]}
            onChange={(e) => {
              const next = { ...current, [key]: e.target.checked };
              setPending(next);
              update.mutate({ contentFilter: next }, { onSettled: () => setPending(null) });
            }}
          />
          {label}
        </label>
      ))}
      <p className="mt-2 text-sm text-slate-600">
        Dotyczy biblioteki i wyszukiwania symboli. Kafelki już ułożone na tablicach się nie
        zmieniają.
      </p>
      {update.isError && (
        <p role="alert" className="mt-2 text-red-800">
          Nie udało się zapisać filtra. Spróbuj ponownie.
        </p>
      )}
    </fieldset>
  );
}
