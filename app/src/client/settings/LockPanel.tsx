import { useId, useState } from 'react';
import { useDeviceSettings } from '../device.ts';
import { hashPin, isPin } from '../edit/pin.ts';
import { ui } from '../edit/ui.ts';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';

/** Optional PIN in front of edit mode on this device (PLAN §2.2). */
export function LockPanel() {
  const [device, update] = useDeviceSettings();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const reset = () => {
    setEditing(false);
    setPin('');
    setRepeat('');
    setError(null);
  };

  async function save(): Promise<void> {
    if (!isPin(pin)) return setError('PIN to dokładnie 4 cyfry.');
    if (pin !== repeat) return setError('PIN-y się różnią.');
    update({ pin: await hashPin(pin) });
    reset();
  }

  const digits = (value: string) => value.replace(/[^0-9]/g, '').slice(0, 4);
  const input = `${ui.input} max-w-40 tracking-[0.5em]`;

  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Blokada trybu edycji (na tym urządzeniu)
      </h2>
      <p className="mt-1 text-slate-600">
        Bez PIN-u tryb edycji otwiera się po przytrzymaniu ołówka przez 2 sekundy. Z PIN-em
        wystarczy dotknąć ołówka i podać PIN — chroni on tablice i ustawienia przed przypadkową
        zmianą i działa tylko na tym urządzeniu.
      </p>
      {editing ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className={ui.field}>
            Nowy PIN (4 cyfry)
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
              className={input}
            />
          </label>
          <label className={ui.field}>
            Powtórz PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(digits(e.target.value))}
              className={input}
            />
          </label>
          <button type="submit" className={ui.primary}>
            Zapisz PIN
          </button>
          <button type="button" className={ui.secondary} onClick={reset}>
            Anuluj
          </button>
          {error && (
            <p role="alert" className="w-full text-red-700">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="font-medium text-slate-700" data-testid="pin-state">
            {device.pin ? 'PIN jest ustawiony.' : 'PIN jest wyłączony.'}
          </span>
          <button type="button" className={ui.secondary} onClick={() => setEditing(true)}>
            {device.pin ? 'Zmień PIN' : 'Ustaw PIN'}
          </button>
          {device.pin && (
            <button type="button" className={ui.danger} onClick={() => update({ pin: null })}>
              Wyłącz PIN
            </button>
          )}
        </div>
      )}
    </section>
  );
}
