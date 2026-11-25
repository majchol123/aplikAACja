import {
  formChoices,
  type FitzgeraldRole,
  type GrammarLexicon,
  type TileGrammar,
} from '@aplikaacja/shared';
import { useMemo } from 'react';
import { Dialog } from '../edit/Dialog.tsx';

/**
 * "Wybierz formę" (PLAN §2.10): every form of a word of the sentence bar, grouped by tense and
 * person or by case. A tap says the form and puts it in the sentence, where the grammar leaves
 * it alone; "Automatycznie" hands the word back.
 */
export function FormPicker({
  label,
  role,
  grammar,
  shown,
  picked,
  lexicon,
  onPick,
  onSpeak,
  onClose,
}: {
  /** The tile's label: the base the forms are made from. */
  label: string;
  role: FitzgeraldRole | null;
  /** The tile's own word ("hulajnoga" like "noga", G3). */
  grammar: TileGrammar | null;
  /** What the bar shows now. */
  shown: string;
  picked: boolean;
  lexicon: GrammarLexicon;
  /** A form, or undefined for "Automatycznie". */
  onPick: (form: string | undefined) => void;
  onSpeak: (text: string) => void;
  onClose: () => void;
}) {
  const groups = useMemo(
    () =>
      formChoices(
        { label, role, fixed: false, ...(grammar?.like ? { like: grammar.like } : {}) },
        lexicon,
      ),
    [label, role, grammar, lexicon],
  );
  const choose = (form: string) => {
    onSpeak(form);
    onPick(form);
  };
  const button =
    'flex min-h-12 flex-col items-start rounded-2xl px-4 py-2 text-left ring-1 ring-slate-300 hover:bg-brand-50';
  return (
    <Dialog
      title={`Wybierz formę: ${label}`}
      onClose={onClose}
      wide
      actions={
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2 font-semibold text-brand-800 ring-1 ring-brand-200"
        >
          Zamknij
        </button>
      }
    >
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${button} ${picked ? '' : 'bg-brand-50 ring-brand-600'}`}
          aria-pressed={!picked}
          onClick={() => onPick(undefined)}
        >
          <span className="font-bold text-slate-900">Automatycznie</span>
          <span className="text-sm text-slate-600">dopasowane do zdania</span>
        </button>
        <button type="button" className={button} onClick={() => choose(label)}>
          <span className="font-bold text-slate-900">{label}</span>
          <span className="text-sm text-slate-600">jak na kafelku</span>
        </button>
      </div>
      {groups.length === 0 && (
        <p className="mt-4 text-slate-700">Tego słowa nie ma w słowniku odmian.</p>
      )}
      {groups.map((group) => (
        <section key={group.title} className="mt-4" aria-label={group.title}>
          <h3 className="text-base font-bold text-brand-900">{group.title}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {group.choices.map((choice) => (
              <button
                key={choice.text}
                type="button"
                className={`${button} ${picked && choice.text === shown ? 'bg-brand-50 ring-brand-600' : ''}`}
                aria-pressed={picked && choice.text === shown}
                onClick={() => choose(choice.text)}
              >
                <span className="text-lg font-bold text-slate-900">{choice.text}</span>
                <span className="text-sm text-slate-600">{choice.hint}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Dialog>
  );
}
