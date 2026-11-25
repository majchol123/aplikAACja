import { DEFAULT_SETTINGS, type GrammarLevel, type SpeakerGender } from '@aplikaacja/shared';
import { useId, useState } from 'react';
import { useDeviceSettings } from '../device.ts';
import { useAccountSettings, useUpdateAccountSettings } from './account.ts';
import { DeviceToggle } from './DevicePanel.tsx';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';
const field = 'block text-sm font-medium text-slate-700';
const select =
  'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30';

const SPEAKERS: { value: SpeakerGender; label: string; example: string }[] = [
  { value: 'm', label: 'Jak chłopiec lub mężczyzna', example: '„zjadłem”, „jestem zmęczony”' },
  { value: 'f', label: 'Jak dziewczynka lub kobieta', example: '„zjadłam”, „jestem zmęczona”' },
];

/**
 * How the user speaks of themselves (F8): asked at the first run and in the settings. Until
 * chosen, the masculine forms are said, as in the dictionary.
 */
export function SpeakerChoice({ legend }: { legend: string }) {
  const account = useAccountSettings();
  const update = useUpdateAccountSettings();
  const [pending, setPending] = useState<SpeakerGender | null>(null);
  const name = useId();
  const current = pending ?? account.data?.speakerGender ?? null;
  return (
    <fieldset className="mt-4" disabled={!account.data || update.isPending}>
      <legend className={field}>{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {SPEAKERS.map((s) => (
          <label
            key={s.value}
            className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-slate-300 has-checked:bg-brand-50 has-checked:ring-brand-600"
          >
            <input
              type="radio"
              name={name}
              className="mt-1 size-5 accent-brand-700"
              checked={current === s.value}
              onChange={() => {
                setPending(s.value);
                update.mutate({ speakerGender: s.value }, { onSettled: () => setPending(null) });
              }}
            />
            <span>
              <span className="block font-semibold text-slate-900">{s.label}</span>
              <span className="block text-sm text-slate-600">{s.example}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Settings → "Odmiana wyrazów" (F8, PLAN §2.10). */
export function GrammarPanel() {
  const id = useId();
  const account = useAccountSettings();
  const update = useUpdateAccountSettings();
  const [pending, setPending] = useState<GrammarLevel | null>(null);
  const level = pending ?? (account.data ?? DEFAULT_SETTINGS).grammar;
  const [device, updateDevice] = useDeviceSettings();
  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Odmiana wyrazów
      </h2>
      <p className="mt-1 text-slate-700">
        Słowa w pasku zdania zmieniają formę, żeby zdanie brzmiało poprawnie: kafelek „iść” mówi
        „idę”, a po „ty” — „idziesz”. Kafelki na tablicy zostają takie, jak są. Przytrzymaj słowo w
        pasku, żeby wybrać formę samemu.
      </p>
      <label className={`${field} mt-4 sm:max-w-sm`}>
        Odmiana w zdaniu
        <select
          className={select}
          disabled={!account.data || update.isPending}
          value={level}
          onChange={(e) => {
            const grammar = e.target.value as GrammarLevel;
            setPending(grammar);
            update.mutate({ grammar }, { onSettled: () => setPending(null) });
          }}
        >
          <option value="full">pełna (ja idę, chcę wody, idę do parku, dwie piłki)</option>
          <option value="verbs">tylko czasowniki (ja idę, ty idziesz)</option>
          <option value="off">wyłączona (słowa jak na kafelkach)</option>
        </select>
      </label>
      <SpeakerChoice legend="Jak użytkownik mówi o sobie?" />
      <DeviceToggle
        checked={device.previewForms}
        onChange={(v) => updateDevice({ previewForms: v })}
        hint="Dla osób, które czytają. Kto nie czyta, szuka kafelka po stałym podpisie i obrazku — wtedy lepiej zostawić wyłączone."
      >
        Podpisy kafelków w formie, jaką słowo przyjmie w zdaniu — po „ty”: „idziesz” (na tym
        urządzeniu)
      </DeviceToggle>
    </section>
  );
}
