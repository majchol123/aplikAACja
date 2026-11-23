import type { Me } from '@aplikaacja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useBoardTree, useSymbolResolver } from '../boards/data.ts';
import { sendHistoryNow } from '../comm/phrases.ts';
import { useDeviceSettings } from '../device.ts';
import { download } from '../shares/files.ts';
import { exportAccount } from './export.ts';

const card = 'rounded-2xl bg-white p-6 shadow-sm ring-1 ring-brand-100';

/** "Pobierz kopię moich danych": the whole account as one file (GDPR art. 20). */
export function ExportPanel({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const tree = useBoardTree();
  const [device] = useDeviceSettings();
  const tiles = useMemo(() => (tree.data?.boards ?? []).flatMap((b) => b.tiles), [tree.data]);
  const resolve = useSymbolResolver(me, tiles);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(): Promise<void> {
    setResult(null);
    setBusy('Przygotowywanie…');
    try {
      await sendHistoryNow(me.id, queryClient);
      const file = await exportAccount(me, device, resolve, setBusy);
      download(file.blob, file.name);
      setResult({
        ok: true,
        text: `Zapisano plik ${file.name}.${
          file.missing ? ` Nie udało się pobrać obrazków: ${file.missing}.` : ''
        }`,
      });
    } catch {
      setResult({ ok: false, text: 'Nie udało się przygotować kopii. Sprawdź połączenie.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={card} aria-labelledby="export-title">
      <h2 id="export-title" className="text-lg font-bold text-brand-900">
        Twoje dane
      </h2>
      <p className="mt-1 text-slate-600">
        Jeden plik ZIP ze wszystkim, co jest na koncie: tablice (plik .obz, który otworzą też inne
        aplikacje AAC), zdjęcia, ulubione frazy, historia wypowiedzi i ustawienia.
      </p>
      <button
        type="button"
        disabled={busy !== null || !tree.data}
        onClick={() => void run()}
        className="mt-4 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
      >
        Pobierz kopię moich danych
      </button>
      {busy && (
        <p role="status" className="mt-3 text-slate-700">
          {busy}
        </p>
      )}
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`mt-3 ${result.ok ? 'text-emerald-800' : 'text-red-700'}`}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}
