import type { AuditEntry } from '@aplikaacja/shared';
import { ui } from '../edit/ui.ts';
import { useAuditLog } from './data.ts';
import { actionDetails, actionLabel, formatDateTime } from './format.ts';

function who(person: { id: string; email: string | null }): string {
  return person.email ?? `konto usunięte (${person.id.slice(0, 6)}…)`;
}

/**
 * Admin actions, newest first (PLAN §2.6). With `target` only the entries about one
 * account, without the account column.
 */
export function AuditLog({ target, label }: { target?: string; label: string }) {
  const log = useAuditLog(target);
  const entries: AuditEntry[] = log.data?.pages.flatMap((page) => page.entries) ?? [];

  if (log.isPending) {
    return (
      <p role="status" className="mt-3 text-slate-600">
        Wczytywanie dziennika…
      </p>
    );
  }
  if (log.isError) {
    return (
      <p role="alert" className="mt-3 text-red-700">
        Nie udało się wczytać dziennika.
      </p>
    );
  }
  if (entries.length === 0) return <p className="mt-3 text-slate-600">Brak wpisów.</p>;

  return (
    <div className="mt-3">
      <div className="hidden overflow-x-auto rounded-xl ring-1 ring-slate-200 sm:block">
        <table className="w-full text-left text-sm" aria-label={label}>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                Kiedy
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Kto
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Co
              </th>
              {!target && (
                <th scope="col" className="px-3 py-2 font-semibold">
                  Konto
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => {
              const details = actionDetails(entry);
              return (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">
                    {formatDateTime(entry.at)}
                  </td>
                  <td className="px-3 py-2 break-words text-slate-800">{who(entry.actor)}</td>
                  <td className="px-3 py-2 text-slate-800">
                    {actionLabel(entry.action)}
                    {details && <span className="text-slate-600">: {details}</span>}
                  </td>
                  {!target && (
                    <td className="px-3 py-2 break-words text-slate-800">
                      {entry.target ? who(entry.target) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Phones: one block per entry instead of columns too narrow for an address. */}
      <ul
        className="divide-y divide-slate-100 rounded-xl text-sm ring-1 ring-slate-200 sm:hidden"
        aria-label={label}
      >
        {entries.map((entry) => {
          const details = actionDetails(entry);
          return (
            <li key={entry.id} className="px-3 py-2">
              <p className="font-semibold text-slate-900">
                {actionLabel(entry.action)}
                {details && <span className="font-normal text-slate-700">: {details}</span>}
              </p>
              {!target && entry.target && (
                <p className="break-words text-slate-800">Konto: {who(entry.target)}</p>
              )}
              <p className="break-words text-slate-600">
                <span className="tabular-nums">{formatDateTime(entry.at)}</span>, {who(entry.actor)}
              </p>
            </li>
          );
        })}
      </ul>
      {log.hasNextPage && (
        <button
          type="button"
          className={`${ui.secondary} mt-3`}
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? 'Wczytywanie…' : 'Pokaż starsze'}
        </button>
      )}
    </div>
  );
}
