import {
  formChoices,
  namesSomeone,
  unknownWord,
  type FitzgeraldRole,
  type GrammarLexicon,
  type GrammarWord,
  type TileGrammar,
} from '@aplikaacja/shared';
import { useId, useMemo, useState } from 'react';
import { ui } from './ui.ts';

/** The word class the lexicon proposes words of, by the tile's colour. */
const POS_OF_ROLE: Partial<Record<FitzgeraldRole, string>> = {
  noun: 'subst',
  person: 'subst',
  verb: 'inf',
  descriptor: 'adj',
};

/** A TileGrammar without the keys left out; null when nothing is left. */
function grammarOf(fixed: boolean, like: string | undefined, someone: boolean | undefined) {
  const out: TileGrammar = {};
  if (fixed) out.fixed = true;
  if (like && !fixed) out.like = like;
  if (someone !== undefined && !fixed) out.someone = someone;
  return Object.keys(out).length > 0 ? out : null;
}

export function sameGrammar(a: TileGrammar | null, b: TileGrammar | null): boolean {
  return (
    Boolean(a?.fixed) === Boolean(b?.fixed) && a?.like === b?.like && a?.someone === b?.someone
  );
}

/**
 * "Odmiana w zdaniu" in the tile editor (F8 G3, PLAN §2.10): how the word will inflect in the
 * sentence, and the user's word over the lexicon's — not at all, like another word (for a word
 * the lexicon does not know: "hulajnoga" like "noga"), naming someone who can do something.
 */
export function GrammarFields({
  label,
  role,
  value,
  lexicon,
  onChange,
}: {
  label: string;
  role: FitzgeraldRole | null;
  value: TileGrammar | null;
  lexicon: GrammarLexicon;
  onChange: (value: TileGrammar | null) => void;
}) {
  const id = useId();
  const text = label.trim();
  const fixed = value?.fixed === true;
  const like = value?.like;
  const unknown = useMemo(() => (text ? unknownWord(text, lexicon) : undefined), [text, lexicon]);
  const suggestions = useMemo(
    () => (unknown ? lexicon.suggestLike(unknown, role ? POS_OF_ROLE[role] : undefined) : []),
    [unknown, role, lexicon],
  );
  // Another word typed by hand: kept here until it fits the word.
  const [typed, setTyped] = useState(like && !suggestions.includes(like) ? like : '');
  const word: GrammarWord = useMemo(
    () => ({ label: text, role, fixed: false, ...(like ? { like } : {}) }),
    [text, role, like],
  );
  const groups = useMemo(
    () => (text && !fixed ? formChoices(word, lexicon).slice(0, 2) : []),
    [text, fixed, word, lexicon],
  );
  const someoneByLexicon = useMemo(
    () => (text ? namesSomeone(word, lexicon) : null),
    [text, word, lexicon],
  );
  const someone = value?.someone ?? someoneByLexicon;
  const set = (next: {
    fixed?: boolean;
    like?: string | undefined;
    someone?: boolean | undefined;
  }) =>
    onChange(
      grammarOf(
        next.fixed ?? fixed,
        'like' in next ? next.like : like,
        'someone' in next ? next.someone : value?.someone,
      ),
    );
  const typedFits = typed !== '' && unknown !== undefined && lexicon.ownWordFits(unknown, typed);
  if (!text) return null;

  return (
    <fieldset className="rounded-xl border border-slate-200 p-3">
      <legend className={`${ui.field} px-1`}>Odmiana w zdaniu</legend>
      <div id={`${id}-forms`} className="text-sm text-slate-700" aria-live="polite">
        {fixed ? (
          <p>W zdaniu zawsze „{text}”.</p>
        ) : groups.length > 0 ? (
          groups.map((g) => (
            <p key={g.title}>
              <span className="font-semibold">{g.title}:</span>{' '}
              {g.choices
                .slice(0, 4)
                .map((c) => c.text)
                .join(' · ')}
            </p>
          ))
        ) : (
          <p>
            {unknown
              ? `Aplikacja nie zna słowa „${unknown}” — w zdaniu zostanie jak na kafelku.`
              : 'To słowo się nie odmienia.'}
          </p>
        )}
      </div>
      <label className="mt-3 flex items-center gap-3 text-slate-700">
        <input
          type="checkbox"
          className="size-5 accent-brand-700"
          checked={fixed}
          onChange={(e) => set({ fixed: e.target.checked })}
        />
        Nie odmieniaj
      </label>
      {!fixed && unknown && (
        <div className="mt-3">
          <p id={`${id}-like-hint`} className="text-sm text-slate-700">
            Odmieniaj „{unknown}” jak słowo, które odmienia się tak samo:
          </p>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={like === s}
                  onClick={() => {
                    setTyped('');
                    set({ like: like === s ? undefined : s });
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                    like === s
                      ? 'bg-brand-700 text-white ring-brand-700'
                      : 'bg-white text-brand-800 ring-brand-300 hover:bg-brand-50'
                  }`}
                >
                  jak „{s}”
                </button>
              ))}
            </div>
          )}
          <label className={`${ui.field} mt-2`}>
            Inne słowo
            <input
              value={typed}
              onChange={(e) => {
                const next = e.target.value.trim();
                setTyped(e.target.value);
                set({ like: next && lexicon.ownWordFits(unknown, next) ? next : undefined });
              }}
              aria-describedby={`${id}-like-hint ${id}-like-check`}
              className={ui.input}
              autoComplete="off"
              maxLength={40}
            />
          </label>
          {typed.trim() !== '' && !typedFits && (
            <p id={`${id}-like-check`} className="mt-1 text-sm text-red-700">
              „{unknown}” nie odmieni się jak „{typed.trim()}”: wybierz słowo o tej samej końcówce,
              które aplikacja zna.
            </p>
          )}
        </div>
      )}
      {!fixed && someone !== null && (
        <label className="mt-3 flex items-start gap-3 text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-brand-700"
            checked={someone}
            onChange={(e) =>
              set({
                someone: e.target.checked === someoneByLexicon ? undefined : e.target.checked,
              })
            }
          />
          <span>
            To ktoś — osoba albo zwierzę, które może coś robić w zdaniu („lalka śpi”, a nie „lalka
            śpię”)
          </span>
        </label>
      )}
    </fieldset>
  );
}
