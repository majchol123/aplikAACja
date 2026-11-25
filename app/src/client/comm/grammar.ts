import {
  BOARD_LIMITS,
  DEFAULT_SETTINGS,
  GrammarLexicon,
  inflectSentence,
  parseGrammarData,
  SET_BASE,
  type FitzgeraldRole,
  type GrammarData,
  type GrammarLevel,
  type LibrarySet,
  type SpeakerGender,
  type TileGrammar,
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
  /** How the tile's word inflects (G3): fixed, like another word, someone or not. */
  grammar?: TileGrammar | null;
}

async function loadData(set: LibrarySet, file: string): Promise<GrammarData> {
  const res = await fetch(SET_BASE[set] + file, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${set} ${file}: HTTP ${res.status}`);
  return parseGrammarData(await res.json());
}

/**
 * The mirror's lexicon joined with the extra set's nouns and adjectives (G2). The extra file
 * comes through the account's gate and is never kept by the service worker; when it fails the
 * mirror's lexicon is enough.
 */
async function loadLexicon(file: string, extraFile: string | undefined): Promise<GrammarLexicon> {
  const [core, extra] = await Promise.all([
    loadData('arasaac', file),
    extraFile
      ? loadData('extra', extraFile).catch((err: unknown) => {
          console.warn('extra set grammar unavailable', err);
          return null;
        })
      : null,
  ]);
  return extra ? new GrammarLexicon(core, extra) : new GrammarLexicon(core);
}

/**
 * The account's grammar settings and the lexicon of the ARASAAC mirror (F8, PLAN §2.10): a
 * public file, whatever sets are active, cached forever under its content-addressed name. With
 * the extra set granted (`extraSet`), its own file joins it.
 */
export function useGrammar(extraSet: boolean): Grammar {
  const account = useAccountSettings();
  const level = account.data?.grammar ?? DEFAULT_SETTINGS.grammar;
  const on = account.data !== undefined && level !== 'off';
  const manifest = useManifest('arasaac', on);
  const extraManifest = useManifest('extra', on && extraSet);
  const file = manifest.data?.grammar;
  // Waits for the extra manifest (a failed one counts as none) so the lexicon is built once.
  const extraSettled = !extraSet || extraManifest.isSuccess || extraManifest.isError;
  const extraFile = extraSet ? extraManifest.data?.grammar : undefined;
  const lexicon = useQuery({
    queryKey: ['grammar', file, extraFile ?? null],
    queryFn: () => loadLexicon(file ?? '', extraFile),
    enabled: on && file !== undefined && extraSettled,
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
      fixed: Boolean(w.fixed || w.speech || w.picked !== undefined || w.grammar?.fixed),
      ...(w.grammar?.like ? { like: w.grammar.like } : {}),
      ...(w.grammar?.someone !== undefined ? { someone: w.grammar.someone } : {}),
    })),
    grammar.lexicon,
    { level: grammar.level, speaker: grammar.speaker },
  );
  // "będę iść" is longer than "iść": a form past the label limit (history, favourites) yields.
  return forms.map((form, i) =>
    form.length > BOARD_LIMITS.labelMax ? (words[i]?.picked ?? words[i]?.label ?? form) : form,
  );
}
