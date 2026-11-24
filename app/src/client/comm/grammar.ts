import {
  BOARD_LIMITS,
  DEFAULT_SETTINGS,
  GrammarLexicon,
  inflectSentence,
  parseGrammarData,
  SET_BASE,
  type FitzgeraldRole,
  type GrammarLevel,
  type SpeakerGender,
} from '@aplikaacja/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useManifest } from '../library/data.ts';
import { useAccountSettings } from '../settings/account.ts';

export interface Grammar {
  /** Null while loading, when switched off, or when the mirror has no grammar file. */
  lexicon: GrammarLexicon | null;
  level: GrammarLevel;
  speaker: SpeakerGender | null;
}

/** A word of the sentence bar, as far as its form goes. */
export interface SentenceWord {
  label: string;
  /** Said instead of the label (Tile.speech): a phrase of its own, never inflected. */
  speech?: string;
  role?: FitzgeraldRole | null;
  /** Said as it was before: history, favourites, the phrase generator. */
  fixed?: boolean;
  /** A form picked by hand ("Wybierz formę"); the grammar leaves it alone. */
  picked?: string;
}

async function loadLexicon(file: string): Promise<GrammarLexicon> {
  const res = await fetch(SET_BASE.arasaac + file, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return new GrammarLexicon(parseGrammarData(await res.json()));
}

/**
 * The account's grammar settings and the lexicon of the ARASAAC mirror (F8, PLAN §2.10): a
 * public file, whatever sets are active, cached forever under its content-addressed name.
 */
export function useGrammar(): Grammar {
  const account = useAccountSettings();
  const level = account.data?.grammar ?? DEFAULT_SETTINGS.grammar;
  const on = account.data !== undefined && level !== 'off';
  const manifest = useManifest('arasaac', on);
  const file = manifest.data?.grammar;
  const lexicon = useQuery({
    queryKey: ['grammar', file],
    queryFn: () => loadLexicon(file ?? ''),
    enabled: on && file !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  const speaker = account.data?.speakerGender ?? null;
  const loaded = on ? (lexicon.data ?? null) : null;
  // Stable while nothing changes: the sentence's forms are memoized on it.
  return useMemo(() => ({ lexicon: loaded, level, speaker }), [loaded, level, speaker]);
}

/** What every word of the bar shows and says; the labels themselves until the lexicon is in. */
export function sentenceForms(words: readonly SentenceWord[], grammar: Grammar): string[] {
  const forms = inflectSentence(
    words.map((w) => ({
      label: w.picked ?? w.label,
      role: w.role ?? null,
      fixed: Boolean(w.fixed || w.speech || w.picked !== undefined),
    })),
    grammar.lexicon,
    { level: grammar.level, speaker: grammar.speaker },
  );
  // "będę iść" is longer than "iść": a form past the label limit (history, favourites) yields.
  return forms.map((form, i) =>
    form.length > BOARD_LIMITS.labelMax ? (words[i]?.picked ?? words[i]?.label ?? form) : form,
  );
}
