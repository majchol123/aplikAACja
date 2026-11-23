import { useCreateHome } from './boards/data.ts';

/** First run of an account: no home board yet. */
export function Onboarding({ onSettings }: { onSettings: () => void }) {
  const create = useCreateHome();
  const option =
    'flex flex-col items-start rounded-2xl bg-white p-6 text-left shadow-sm ring-1 ring-brand-100 hover:ring-brand-600 disabled:opacity-60';
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-6 py-8">
      <h1 className="text-3xl font-extrabold text-brand-900">Przygotujmy pierwszą tablicę</h1>
      <p className="text-lg text-slate-700">
        Tablicę można potem dowolnie zmieniać w trybie edycji: dodawać słowa, foldery i zdjęcia.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          className={option}
          disabled={create.isPending}
          onClick={() => create.mutate({ template: 'starter' })}
        >
          <span className="text-xl font-bold text-brand-800">Tablica startowa</span>
          <span className="mt-1 text-slate-600">
            Najczęstsze słowa (ja, chcę, tak, nie, proszę, pomocy…) i foldery: Osoby, Jedzenie,
            Picie, Uczucia, Ciało, Miejsca, Zabawa, Ubrania.
          </span>
        </button>
        <button
          type="button"
          className={option}
          disabled={create.isPending}
          onClick={() => create.mutate({ rows: 4, cols: 6 })}
        >
          <span className="text-xl font-bold text-brand-800">Pusta tablica</span>
          <span className="mt-1 text-slate-600">Siatka 4 × 6 do samodzielnego wypełnienia.</span>
        </button>
      </div>
      {create.isError && (
        <p role="alert" className="text-red-700">
          Nie udało się utworzyć tablicy. Spróbuj ponownie.
        </p>
      )}
      <button
        type="button"
        onClick={onSettings}
        className="self-start text-brand-800 underline underline-offset-4"
      >
        Ustawienia i konto
      </button>
    </div>
  );
}
