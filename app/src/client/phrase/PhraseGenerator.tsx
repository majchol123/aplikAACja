import {
  BOARD_LIMITS,
  buildPhrase,
  PHRASE_LIMITS,
  phraseText,
  type Board,
  type BoardChanges,
  type BoardPackage,
  type FitzgeraldRole,
  type FontSize,
  type Me,
  type PhraseItem,
  type PhraseSlot,
  type SymbolHit,
  type SymbolRef,
} from '@relaacja/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, ApiError } from '../api.ts';
import { ROLE_COLORS } from '../boards/colors.ts';
import { applyChanges } from '../boards/data.ts';
import { usePreferredSymbols } from '../boards/preferred.ts';
import { useAddFavorite } from '../comm/phrases.ts';
import { Dialog } from '../edit/Dialog.tsx';
import { SymbolPicker, type PickerItem } from '../edit/SymbolPicker.tsx';
import { ui } from '../edit/ui.ts';
import { useLibrary } from '../library/useLibrary.ts';
import { shareProblem } from '../shares/data.ts';
import { download } from '../shares/files.ts';
import { useSpeaker } from '../speech.ts';
import { ARASAAC_NOTE } from '../library/attribution.ts';
import { phrasePng, ROLE_CSS, type Card } from './render.ts';

/** A picture shown for a word: a library symbol or an own photo. */
interface Pic {
  symbol: SymbolRef;
  src: string;
  /** Name of the symbol or the photo. */
  name: string;
  role: FitzgeraldRole | null;
}
/** A word's own choice: one of its candidates, another picture, or none. */
type Choice = number | null | Pic;
type ColorMode = 'background' | 'border' | 'none';

interface Look {
  labelTop: boolean;
  size: FontSize;
  colors: ColorMode;
  uppercase: boolean;
  /** Label from the text as written ("pije") or the symbol's name ("pić"). */
  symbolNames: boolean;
  skipFunctionWords: boolean;
}

interface Shown {
  slot: PhraseSlot;
  pic: Pic | null;
  label: string;
}

const CARD: Record<FontSize, string> = {
  S: 'w-24 text-sm',
  M: 'w-32 text-base',
  L: 'w-40 text-lg',
  XL: 'w-48 text-xl',
};

function shown(slots: PhraseSlot[], overrides: ReadonlyMap<string, Choice>, look: Look): Shown[] {
  return slots.map((slot, i) => {
    const override = overrides.get(`${i}:${slot.text}`);
    const choice = override === undefined ? slot.chosen : override;
    const hit = typeof choice === 'number' ? slot.candidates[choice] : undefined;
    const pic = hit ? fromHit(hit) : typeof choice === 'object' ? choice : null;
    const label = look.symbolNames && pic ? pic.name : slot.text;
    return { slot, pic, label: clip(label, BOARD_LIMITS.labelMax) };
  });
}

const fromHit = (hit: SymbolHit): Pic => ({
  symbol: { set: hit.set, ref: String(hit.id) },
  src: hit.src,
  name: hit.label,
  role: hit.role,
});
const sameSymbol = (a: SymbolRef, b: SymbolRef) => a.set === b.set && a.ref === b.ref;
const clip = (text: string, max: number) => [...text].slice(0, max).join('').trim();
const roleOf = (pic: Pic | null, colors: ColorMode) =>
  colors === 'none' || !pic?.role ? 'none' : pic.role;

/**
 * Phrase generator (PLAN §2.3): a text becomes a row of symbols; each word's symbol can be
 * changed or removed; the row is read out, put in the sentence bar or the favourites,
 * saved as a board, exported as PNG or printed (with the ARASAAC credit).
 */
export function PhraseGenerator({
  me,
  board,
  onToSentence,
  onClose,
}: {
  me: Me;
  /** Edit mode: "Zapisz jako tablicę" adds a folder with the phrase on this board. */
  board?: Board;
  /** Communication mode: the phrase goes to the sentence bar. */
  onToSentence?: (items: (PhraseItem & { src: string | null })[]) => void;
  onClose: () => void;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const library = useLibrary(me);
  const preferred = usePreferredSymbols();
  const speak = useSpeaker();
  const favorite = useAddFavorite();
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const [look, setLook] = useState<Look>({
    labelTop: false,
    size: 'M',
    colors: 'border',
    uppercase: false,
    symbolNames: false,
    skipFunctionWords: false,
  });
  const [overrides, setOverrides] = useState<Map<string, Choice>>(new Map());
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const preferredKeys = useMemo(
    () =>
      new Map(
        [...(preferred.data ?? new Map<string, SymbolRef>())].map(([w, s]) => [
          w,
          `${s.set}:${s.ref}`,
        ]),
      ),
    [preferred.data],
  );
  const slots = useMemo(
    () =>
      library.size > 0 && deferred.trim()
        ? buildPhrase(deferred, library.search, {
            skipFunctionWords: look.skipFunctionWords,
            preferred: preferredKeys,
          })
        : [],
    [deferred, library.search, library.size, look.skipFunctionWords, preferredKeys],
  );
  const items = useMemo(() => shown(slots, overrides, look), [slots, overrides, look]);
  const usesArasaac = items.some((i) => i.pic?.symbol.set === 'arasaac');
  const phrase: PhraseItem[] = items.map((i) => ({
    label: i.label,
    symbol: i.pic?.symbol ?? null,
  }));
  const colorsOf = (pic: Pic | null) => {
    const role = roleOf(pic, look.colors);
    return { classes: ROLE_COLORS[role], css: ROLE_CSS[role] };
  };
  const choose = (i: number, choice: Choice) => {
    const slot = slots[i];
    if (!slot) return;
    setOverrides((map) => new Map(map).set(`${i}:${slot.text}`, choice));
    setEditing(null);
  };

  async function saveBoard(): Promise<void> {
    if (!board || items.length === 0) return;
    setBusy(true);
    setNotice(null);
    const cols = Math.min(BOARD_LIMITS.maxCols, Math.max(1, Math.min(6, items.length)));
    const rows = Math.min(BOARD_LIMITS.maxRows, Math.ceil(items.length / cols));
    const name = clip(phraseText(items), BOARD_LIMITS.labelMax);
    const pkg: BoardPackage = {
      v: 1,
      name,
      board: {
        rows,
        cols,
        tiles: items.slice(0, rows * cols).map((item, i) => ({
          row: Math.floor(i / cols),
          col: i % cols,
          kind: 'word',
          label: item.label,
          labelPosition: look.labelTop ? 'top' : 'bottom',
          fontSize: look.size,
          colorRole: look.colors === 'none' ? null : (item.pic?.role ?? null),
          colorMode: look.colors === 'background' ? 'background' : 'border',
          symbol: item.pic?.symbol ?? null,
        })),
      },
    };
    try {
      const changes = await api<BoardChanges>(`/api/boards/${board.id}/import`, {
        method: 'POST',
        json: { rev: board.rev, package: pkg },
      });
      applyChanges(queryClient, changes);
      setNotice({ ok: true, text: `Dodano tablicę „${name}” na tablicy „${board.name}”.` });
    } catch (err) {
      setNotice({
        ok: false,
        text:
          err instanceof ApiError && err.code === 'invalid_request'
            ? 'Nie udało się zapisać tablicy z tej frazy.'
            : shareProblem(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function savePng(): Promise<void> {
    setBusy(true);
    try {
      const cards: Card[] = items.map((item) => ({
        label: item.label,
        src: item.pic?.src ?? null,
        border: colorsOf(item.pic).css.border,
        background: look.colors === 'background' ? colorsOf(item.pic).css.background : '#ffffff',
      }));
      const blob = await phrasePng(cards, {
        labelTop: look.labelTop,
        uppercase: look.uppercase,
        credit: usesArasaac,
      });
      download(blob, 'fraza.png');
    } finally {
      setBusy(false);
    }
  }

  const edited = editing === null ? undefined : items[editing];

  return (
    <Dialog title="Generator fraz" onClose={onClose} wide>
      <label htmlFor={`${id}-text`} className={ui.field}>
        Napisz zdanie albo słowa
      </label>
      <textarea
        id={`${id}-text`}
        rows={2}
        maxLength={400}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setNotice(null);
        }}
        className={`${ui.input} mt-1`}
      />

      {text.trim() && library.size === 0 && (
        <p role="status" className="mt-4 text-slate-600">
          Wczytywanie symboli…
        </p>
      )}
      {items.length > 0 && (
        <section className="mt-4" aria-label="Fraza w symbolach">
          <ul className="flex flex-wrap gap-2" data-testid="phrase">
            {items.map((item, i) => {
              const colors = colorsOf(item.pic);
              const filled = look.colors === 'background';
              const label = (
                <span
                  className={`font-bold leading-tight text-slate-900 ${look.uppercase ? 'uppercase' : ''}`}
                >
                  {item.label}
                </span>
              );
              return (
                <li key={`${i}:${item.slot.text}`}>
                  <button
                    type="button"
                    aria-label={`${item.label}: zmień symbol`}
                    onClick={() => setEditing(i)}
                    className={`flex h-full ${CARD[look.size]} flex-col items-center gap-1 rounded-2xl border-4 p-2 ${colors.classes.border} ${filled ? colors.classes.background : 'bg-white'}`}
                  >
                    {look.labelTop && label}
                    {item.pic ? (
                      <img
                        src={item.pic.src}
                        alt=""
                        className="aspect-square w-full object-contain"
                      />
                    ) : (
                      <span className="aspect-square w-full" />
                    )}
                    {!look.labelTop && label}
                  </button>
                </li>
              );
            })}
          </ul>
          {usesArasaac && <p className="mt-2 text-xs text-slate-500">{ARASAAC_NOTE}</p>}
        </section>
      )}

      {items.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={ui.primary} onClick={() => speak(phraseText(items))}>
            Odczytaj
          </button>
          {onToSentence && (
            <button
              type="button"
              className={ui.secondary}
              onClick={() =>
                onToSentence(phrase.map((p, i) => ({ ...p, src: items[i]?.pic?.src ?? null })))
              }
            >
              Do paska zdaniowego
            </button>
          )}
          <button
            type="button"
            className={ui.secondary}
            disabled={favorite.isPending || phrase.length > PHRASE_LIMITS.maxItems}
            onClick={() =>
              favorite.mutate(phrase, {
                onSuccess: () => setNotice({ ok: true, text: 'Zapisano w ulubionych.' }),
                onError: () =>
                  setNotice({ ok: false, text: 'Nie udało się zapisać w ulubionych.' }),
              })
            }
          >
            Do ulubionych
          </button>
          {board && (
            <button
              type="button"
              className={ui.secondary}
              disabled={busy}
              onClick={() => void saveBoard()}
            >
              Zapisz jako tablicę
            </button>
          )}
          <button
            type="button"
            className={ui.secondary}
            disabled={busy}
            onClick={() => void savePng()}
          >
            Zapisz obraz PNG
          </button>
          <button type="button" className={ui.secondary} onClick={() => window.print()}>
            Drukuj
          </button>
        </div>
      )}
      <fieldset className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-slate-800">
        <legend className="sr-only">Wygląd</legend>
        <label className="flex items-center gap-2">
          Napis
          <select
            value={look.labelTop ? 'top' : 'bottom'}
            onChange={(e) => setLook({ ...look, labelTop: e.target.value === 'top' })}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="bottom">pod symbolem</option>
            <option value="top">nad symbolem</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Rozmiar
          <select
            value={look.size}
            onChange={(e) => setLook({ ...look, size: e.target.value as FontSize })}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="S">mały</option>
            <option value="M">średni</option>
            <option value="L">duży</option>
            <option value="XL">bardzo duży</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Kolory
          <select
            value={look.colors}
            onChange={(e) => setLook({ ...look, colors: e.target.value as ColorMode })}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="border">ramka (Fitzgerald)</option>
            <option value="background">tło (Fitzgerald)</option>
            <option value="none">bez kolorów</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={look.uppercase}
            onChange={(e) => setLook({ ...look, uppercase: e.target.checked })}
          />
          Wielkie litery
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={look.symbolNames}
            onChange={(e) => setLook({ ...look, symbolNames: e.target.checked })}
          />
          Napisy z nazw symboli („pić” zamiast „pije”)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={look.skipFunctionWords}
            onChange={(e) => setLook({ ...look, skipFunctionWords: e.target.checked })}
          />
          Bez symboli dla słów funkcyjnych (i, w, na, z…)
        </label>
      </fieldset>
      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`mt-3 ${notice.ok ? 'text-emerald-800' : 'text-red-700'}`}
        >
          {notice.text}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>

      {items.length > 0 &&
        createPortal(<PrintSheet items={items} look={look} credit={usesArasaac} />, document.body)}
      {edited && editing !== null && (
        <SlotEditor
          me={me}
          item={edited}
          onChoose={(choice) => choose(editing, choice)}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  );
}

/** What `window.print()` puts on paper: only the phrase (styles.css, `.phrase-sheet`). */
function PrintSheet({ items, look, credit }: { items: Shown[]; look: Look; credit: boolean }) {
  return (
    <div className="phrase-sheet" aria-hidden="true">
      <ul className="flex flex-wrap gap-[4mm]">
        {items.map((item, i) => {
          const colors = ROLE_COLORS[roleOf(item.pic, look.colors)];
          const src = item.pic?.src;
          const label = (
            <span
              className={`text-[14pt] font-bold leading-tight ${look.uppercase ? 'uppercase' : ''}`}
            >
              {item.label}
            </span>
          );
          return (
            <li
              key={`${i}:${item.slot.text}`}
              className={`flex w-[40mm] flex-col items-center gap-[1mm] rounded-[3mm] border-[1.2mm] p-[2mm] text-center ${colors.border} ${look.colors === 'background' ? colors.background : 'bg-white'}`}
            >
              {look.labelTop && label}
              {src ? (
                <img src={src} alt="" className="aspect-square w-full object-contain" />
              ) : (
                <span className="aspect-square w-full" />
              )}
              {!look.labelTop && label}
            </li>
          );
        })}
      </ul>
      {credit && <p className="mt-[6mm] text-[9pt]">{ARASAAC_NOTE}</p>}
    </div>
  );
}

/**
 * Another picture for one word: the library picker (every variant of the word, own photos,
 * categories), starting with the word itself; or none.
 */
function SlotEditor({
  me,
  item,
  onChoose,
  onClose,
}: {
  me: Me;
  item: Shown;
  onChoose: (choice: Choice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(item.slot.text);
  const pick = (picked: PickerItem) => {
    const i = item.slot.candidates.findIndex((c) => sameSymbol(fromHit(c).symbol, picked.symbol));
    onChoose(
      i >= 0 ? i : { symbol: picked.symbol, src: picked.src, name: picked.word, role: picked.role },
    );
  };
  return (
    <Dialog title={`Symbol dla „${item.slot.text}”`} onClose={onClose} wide>
      <div className="mt-3">
        <SymbolPicker
          me={me}
          query={query}
          onQuery={setQuery}
          selected={item.pic?.symbol ?? null}
          onPick={pick}
        />
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className={ui.secondary} onClick={() => onChoose(null)}>
          Bez symbolu
        </button>
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}
