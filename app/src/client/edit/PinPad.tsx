import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { forgetHistory } from '../comm/phrases.ts';
import { forgetUsage } from '../comm/usage.ts';
import { useDeviceSettings } from '../device.ts';
import { Dialog } from './Dialog.tsx';
import { checkPin, PIN_LENGTH, type StoredPin } from './pin.ts';
import { ui } from './ui.ts';

const MAX_TRIES = 5;
const COOLDOWN_MS = 30_000;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

/** PIN in front of edit mode on this device (PLAN §2.2). */
export function PinPad({
  pin,
  onUnlock,
  onCancel,
}: {
  pin: StoredPin;
  onUnlock: () => void;
  onCancel: () => void;
}) {
  const [, updateDevice] = useDeviceSettings();
  const [digits, setDigits] = useState('');
  const [wrong, setWrong] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);
  const checking = useRef(false);
  const blocked = blockedUntil > now;

  useEffect(() => {
    if (!blocked) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [blocked]);

  const press = (key: string) => {
    if (blocked || checking.current) return;
    if (key === '⌫') return setDigits((d) => d.slice(0, -1));
    if (!/^[0-9]$/.test(key) || digits.length >= PIN_LENGTH) return;
    const next = digits + key;
    setDigits(next);
    if (next.length < PIN_LENGTH) return;
    checking.current = true;
    void checkPin(next, pin).then((ok) => {
      checking.current = false;
      if (ok) return onUnlock();
      setDigits('');
      const tries = wrong + 1;
      setWrong(tries);
      if (tries % MAX_TRIES === 0) {
        setBlockedUntil(Date.now() + COOLDOWN_MS);
        setNow(Date.now());
      }
    });
  };

  const forget = async () => {
    // Re-entering needs a Google sign-in, which is what the PIN stands in for.
    updateDevice({ pin: null });
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    forgetHistory();
    forgetUsage();
    location.assign('/');
  };

  if (forgot) {
    return (
      <Dialog title="Nie pamiętasz PIN-u?" onClose={onCancel}>
        <p className="mt-3 text-slate-700">
          PIN można usunąć z tego urządzenia, wylogowując się. Potem trzeba zalogować się ponownie
          kontem Google — PIN nie będzie już wymagany, można ustawić nowy w ustawieniach.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" className={ui.secondary} onClick={() => setForgot(false)}>
            Wróć
          </button>
          <button type="button" className={ui.danger} onClick={() => void forget()}>
            Wyloguj i usuń PIN
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Podaj PIN" onClose={onCancel}>
      <div
        // Physical keyboards: digits and Backspace work as well.
        onKeyDown={(e) => {
          if (/^[0-9]$/.test(e.key)) press(e.key);
          else if (e.key === 'Backspace') press('⌫');
        }}
      >
        <p className="mt-1 text-slate-600">Tryb edycji na tym urządzeniu jest chroniony PIN-em.</p>
        <div className="mt-4 flex justify-center gap-3" aria-hidden="true">
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span
              key={i}
              className={`size-5 rounded-full border-2 border-brand-700 ${i < digits.length ? 'bg-brand-700' : ''}`}
            />
          ))}
        </div>
        <p className="mt-3 min-h-6 text-center text-red-700" role="alert">
          {blocked
            ? `Za dużo prób. Spróbuj za ${Math.ceil((blockedUntil - now) / 1000)} s.`
            : wrong > 0
              ? 'Nieprawidłowy PIN.'
              : ''}
        </p>
        <p className="sr-only" aria-live="polite">
          Wpisano cyfr: {digits.length} z {PIN_LENGTH}
        </p>
        <div className="mx-auto mt-2 grid max-w-72 grid-cols-3 gap-3">
          {KEYS.map((key, i) =>
            key === '' ? (
              <span key={i} />
            ) : (
              <button
                key={key}
                type="button"
                disabled={blocked}
                aria-label={key === '⌫' ? 'Usuń cyfrę' : key}
                onClick={() => press(key)}
                className="h-16 rounded-2xl bg-slate-100 text-2xl font-bold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
              >
                {key}
              </button>
            ),
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="text-brand-800 underline underline-offset-4"
            onClick={() => setForgot(true)}
          >
            Nie pamiętam PIN-u
          </button>
          <button type="button" className={ui.secondary} onClick={onCancel}>
            Anuluj
          </button>
        </div>
      </div>
    </Dialog>
  );
}
