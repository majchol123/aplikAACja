import { PHRASE_LIMITS, phraseText, type PhraseItem, type Tile } from '@aplikaacja/shared';
import { useId, useMemo, useState } from 'react';
import { Dialog } from '../edit/Dialog.tsx';
import { ui } from '../edit/ui.ts';
import { StarIcon } from './icons.tsx';
import { useAddFavorite, useFavorites, useRemoveFavorite, type HistoryEntry } from './phrases.ts';

/** One phrase as its pictures and words; tapping it says it again. */
function Phrase({
  items,
  resolve,
  onPlay,
}: {
  items: PhraseItem[];
  resolve: (symbol: Tile['symbol']) => string | null;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Powiedz: ${phraseText(items)}`}
      className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-2xl bg-white p-2 text-left ring-1 ring-slate-200 hover:bg-brand-50"
    >
      {items.map((item, i) => {
        const src = resolve(item.symbol);
        return (
          <span key={i} className="flex shrink-0 flex-col items-center">
            {src && <img src={src} alt="" className="size-12 object-contain" />}
            <span className="font-bold leading-tight text-slate-900">{item.label}</span>
          </span>
        );
      })}
    </button>
  );
}

/**
 * Last utterances and favourite phrases of the account (PLAN §2.1): one tap says a phrase
 * again and puts it in the sentence bar.
 */
export function HistoryPanel({
  history,
  keep,
  loading,
  clearing,
  resolve,
  onPlay,
  onClearHistory,
  onClose,
}: {
  history: HistoryEntry[];
  /** The account keeps a history (Settings.keepHistory). */
  keep: boolean;
  loading: boolean;
  clearing: boolean;
  resolve: (symbol: Tile['symbol']) => string | null;
  onPlay: (items: PhraseItem[]) => void;
  onClearHistory: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const favorites = useFavorites();
  const add = useAddFavorite();
  const remove = useRemoveFavorite();
  const saved = useMemo(
    () => new Map((favorites.data?.favorites ?? []).map((f) => [phraseText(f.items), f.id])),
    [favorites.data],
  );
  const full = (favorites.data?.favorites.length ?? 0) >= PHRASE_LIMITS.maxFavorites;

  return (
    <Dialog title="Historia i ulubione" onClose={onClose} wide>
      <section className="mt-3" aria-labelledby={`${id}-fav`}>
        <h3 id={`${id}-fav`} className="font-bold text-brand-900">
          Ulubione
        </h3>
        {favorites.isSuccess && favorites.data.favorites.length === 0 && (
          <p className="mt-1 text-slate-600">
            Brak ulubionych. Dotknij gwiazdki przy wypowiedzi, aby ją tu zapisać.
          </p>
        )}
        <ul className="mt-2 space-y-2" aria-label="Ulubione frazy">
          {(favorites.data?.favorites ?? []).map((favorite) => (
            <li key={favorite.id} className="flex items-stretch gap-2">
              <Phrase
                items={favorite.items}
                resolve={resolve}
                onPlay={() => onPlay(favorite.items)}
              />
              <button
                type="button"
                aria-label={`Usuń z ulubionych: ${phraseText(favorite.items)}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(favorite.id)}
                className="flex w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 ring-1 ring-amber-300"
              >
                <StarIcon className="size-7" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5 border-t border-slate-200 pt-4" aria-labelledby={`${id}-recent`}>
        <h3 id={`${id}-recent`} className="font-bold text-brand-900">
          Ostatnie wypowiedzi
        </h3>
        {!keep && (
          <p className="mt-1 text-slate-600">
            Historia jest wyłączona (Ustawienia → „Zapisuj historię wypowiedzi”).
          </p>
        )}
        {keep && history.length === 0 && (
          <p className="mt-1 text-slate-600" role={loading ? 'status' : undefined}>
            {loading ? 'Wczytywanie…' : 'Jeszcze nic nie powiedziano.'}
          </p>
        )}
        <ul className="mt-2 space-y-2" aria-label="Ostatnie wypowiedzi">
          {history.map((entry) => {
            const text = phraseText(entry.items);
            const favorite = saved.get(text);
            return (
              <li key={`${entry.at}-${text}`} className="flex items-stretch gap-2">
                <Phrase items={entry.items} resolve={resolve} onPlay={() => onPlay(entry.items)} />
                <button
                  type="button"
                  aria-label={
                    favorite ? `Usuń z ulubionych: ${text}` : `Dodaj do ulubionych: ${text}`
                  }
                  aria-pressed={Boolean(favorite)}
                  disabled={add.isPending || remove.isPending || (!favorite && full)}
                  onClick={() => (favorite ? remove.mutate(favorite) : add.mutate(entry.items))}
                  className={`flex w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ${
                    favorite
                      ? 'bg-amber-100 text-amber-600 ring-amber-300'
                      : 'bg-white text-slate-300 ring-slate-200'
                  }`}
                >
                  <StarIcon className="size-7" />
                </button>
              </li>
            );
          })}
        </ul>
        {history.length > 0 && !confirming && (
          <button
            type="button"
            className={`${ui.secondary} mt-3`}
            onClick={() => setConfirming(true)}
          >
            Wyczyść historię
          </button>
        )}
        {history.length > 0 && confirming && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-slate-800">Wyczyścić historię na wszystkich urządzeniach?</span>
            <button
              type="button"
              className={ui.danger}
              disabled={clearing}
              onClick={() => {
                onClearHistory();
                setConfirming(false);
              }}
            >
              Tak, wyczyść
            </button>
            <button type="button" className={ui.secondary} onClick={() => setConfirming(false)}>
              Anuluj
            </button>
          </div>
        )}
      </section>
      {(add.isError || remove.isError) && (
        <p role="alert" className="mt-3 text-red-700">
          Nie udało się zapisać ulubionych. Sprawdź połączenie.
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}
