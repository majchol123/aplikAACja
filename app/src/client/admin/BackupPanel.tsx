import { AGE_RECIPIENT_RE, type BackupConfigured, type BackupStatus } from '@aplikaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { ui } from '../edit/ui.ts';
import { formatDateTime } from './format.ts';

const KEY = ['admin', 'backup'] as const;
const card = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-100 sm:p-6';

/** Long post-quantum recipients are shown by their ends. */
const short = (recipient: string) =>
  recipient.length > 70 ? `${recipient.slice(0, 24)}…${recipient.slice(-12)}` : recipient;

/**
 * Encrypted backups (F7, PLAN §6), superadmins only: the age recipient every file is
 * encrypted for and the access key of the backup job, shown once right after it is made.
 */
export function BackupPanel() {
  const id = useId();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => api<BackupStatus>('/api/admin/backup'),
  });
  const [recipient, setRecipient] = useState('');
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const configure = useMutation({
    mutationFn: (value: string) =>
      api<BackupConfigured>('/api/admin/backup', { method: 'PUT', json: { recipient: value } }),
    onSuccess: (answer) => {
      queryClient.setQueryData(KEY, answer.status);
      setToken(answer.token);
      setCopied(false);
      setEditing(false);
      setRecipient('');
    },
  });
  const disable = useMutation({
    mutationFn: () => api('/api/admin/backup', { method: 'DELETE' }),
    onSuccess: () => {
      setToken(null);
      setConfirmOff(false);
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
  const value = recipient.trim();
  const valid = AGE_RECIPIENT_RE.test(value);
  const data = status.data;
  const showForm = data && (!data.configured || editing);

  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-bold text-brand-900">
        Kopie zapasowe
      </h2>
      <p className="mt-1 text-slate-600">
        Zadanie kopii (<code>tools/backup.py</code>) pobiera wszystkie konta, katalog tablic i
        dziennik zdarzeń. Każdy plik szyfruje serwer kluczem publicznym age, więc klucz dostępu
        zadania daje tylko zaszyfrowane pliki, a klucz prywatny zostaje poza Cloudflare.
      </p>

      {status.isPending && <p className="mt-4 text-slate-600">Wczytywanie…</p>}
      {status.isError && (
        <p role="alert" className="mt-4 text-red-700">
          Nie udało się wczytać ustawień kopii.
        </p>
      )}

      {data?.configured && (
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold text-slate-700">Klucz publiczny</dt>
          <dd className="break-all font-mono text-sm" data-testid="backup-recipient">
            {data.recipient ? short(data.recipient) : '—'}
          </dd>
          <dt className="font-semibold text-slate-700">Ustawione</dt>
          <dd>{formatDateTime(data.createdAt)}</dd>
          <dt className="font-semibold text-slate-700">Ostatnia kopia</dt>
          <dd data-testid="backup-last-run">
            {data.lastUsedAt ? formatDateTime(data.lastUsedAt) : 'jeszcze nie było'}
          </dd>
        </dl>
      )}

      {token && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-300" role="status">
          <p className="font-semibold text-amber-950">
            Klucz dostępu zadania kopii — widać go tylko teraz.
          </p>
          <p className="mt-1 text-sm text-amber-950">
            Zapisz go w konfiguracji zadania (zmienna <code>APLIKAACJA_BACKUP_TOKEN</code> albo plik{' '}
            <code>--token-file</code>). Poprzedni klucz dostępu już nie działa.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              readOnly
              value={token}
              aria-label="Klucz dostępu zadania kopii"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <button
              type="button"
              className={ui.secondary}
              onClick={() => void navigator.clipboard.writeText(token).then(() => setCopied(true))}
            >
              {copied ? 'Skopiowano' : 'Kopiuj'}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) configure.mutate(value);
          }}
        >
          <label htmlFor={`${id}-recipient`} className={ui.field}>
            Klucz publiczny age (<code>age1…</code>, z <code>age-keygen</code>)
          </label>
          <input
            id={`${id}-recipient`}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={`${ui.input} font-mono text-sm`}
          />
          <p className="mt-1 text-sm text-slate-600">
            Klucz prywatny (<code>AGE-SECRET-KEY-…</code>) nigdy tu nie trafia: przechowuj go poza
            serwerem kopii, bo tylko nim da się kopię odczytać.
          </p>
          {configure.isError && (
            <p role="alert" className="mt-2 text-red-700">
              {configure.error instanceof ApiError && configure.error.code === 'invalid_request'
                ? 'To nie jest poprawny klucz publiczny age.'
                : 'Nie udało się zapisać. Spróbuj ponownie.'}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="submit" className={ui.primary} disabled={!valid || configure.isPending}>
              {data?.configured ? 'Zapisz i utwórz nowy klucz dostępu' : 'Włącz kopie zapasowe'}
            </button>
            {editing && (
              <button type="button" className={ui.secondary} onClick={() => setEditing(false)}>
                Anuluj
              </button>
            )}
          </div>
        </form>
      )}

      {data?.configured && !editing && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className={ui.secondary}
            onClick={() => {
              setEditing(true);
              setConfirmOff(false);
            }}
          >
            Zmień klucz publiczny lub klucz dostępu
          </button>
          {!confirmOff ? (
            <button type="button" className={ui.danger} onClick={() => setConfirmOff(true)}>
              Wyłącz kopie zapasowe
            </button>
          ) : (
            <div
              className="flex flex-wrap items-center gap-3"
              role="group"
              aria-label="Potwierdzenie"
            >
              <span className="text-red-800">Zadanie kopii przestanie działać. Wyłączyć?</span>
              <button
                type="button"
                className={ui.danger}
                disabled={disable.isPending}
                onClick={() => disable.mutate()}
              >
                Tak, wyłącz
              </button>
              <button type="button" className={ui.secondary} onClick={() => setConfirmOff(false)}>
                Anuluj
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
