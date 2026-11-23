import { normalizeText, tokenize } from './normalize.ts';
import type { SymbolHit } from './search.ts';

/**
 * Phrase generator (PLAN §2.3, a counterpart of AraWrite for Polish): text → words →
 * longest multi-word symbol names (4 → 1 words) → symbols for the rest through the
 * inflection lexicon of the library search, ranked by the user's preferred variants.
 */

/** Words of a text, as written (punctuation and spaces dropped). */
export function splitWords(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    return [...new Segmenter('pl', { granularity: 'word' }).segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
  }
  return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Short words that carry grammar more than meaning; optionally shown without a symbol. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  [
    'a',
    'ale',
    'aż',
    'bo',
    'by',
    'czy',
    'do',
    'dla',
    'i',
    'iż',
    'jak',
    'jednak',
    'ku',
    'lub',
    'na',
    'nad',
    'o',
    'od',
    'oraz',
    'po',
    'pod',
    'przed',
    'przez',
    'przy',
    'się',
    'u',
    'w',
    'we',
    'z',
    'za',
    'ze',
    'że',
    'albo',
    'lecz',
    'więc',
    'zaś',
    'niż',
    'bez',
    'około',
  ].map(normalizeText),
);

/** Finds symbols for a query; `exact` means no type-ahead (the query is complete). */
export type FindSymbols = (query: string, limit: number) => SymbolHit[];

export interface PhraseSlot {
  /** The words of the text this slot stands for, as written. */
  text: string;
  /** How many words of the text (more than one for "dzień dobry"). */
  words: number;
  /** Best first; empty when nothing was found. */
  candidates: SymbolHit[];
  /** Index into `candidates`, or null: no symbol (nothing found, a skipped word, a choice). */
  chosen: number | null;
  functionWord: boolean;
}

export interface PhraseOptions {
  /** Function words get no symbol (the word itself stays). */
  skipFunctionWords: boolean;
  /** Preferred variant of a word (normalized symbol name → `set:id`), PLAN §2.2. */
  preferred: ReadonlyMap<string, string>;
  /** Longest name tried (PLAN: 4). */
  window?: number;
  /** Candidates kept per slot. */
  candidates?: number;
}

const key = (hit: SymbolHit) => `${hit.set}:${hit.id}`;

/** Every query word matched exactly or through its lemma, and nothing more is in the name. */
function wholeName(hit: SymbolHit, words: number): boolean {
  return tokenize(hit.label).length === words && hit.score >= 300 + 90 * words - 20;
}

/** Puts the user's preferred variant first (by the name of the symbol that matched). */
function withPreferred(hits: SymbolHit[], preferred: ReadonlyMap<string, string>): SymbolHit[] {
  for (const hit of hits) {
    const wanted = preferred.get(normalizeText(hit.label));
    if (!wanted) continue;
    const i = hits.findIndex((h) => key(h) === wanted);
    if (i > 0) return [hits[i] as SymbolHit, ...hits.slice(0, i), ...hits.slice(i + 1)];
    return hits;
  }
  return hits;
}

/**
 * Slots of a text. A multi-word name ("dzień dobry", "myć zęby") is used only when it
 * matches all its words; single words take what the library finds for them, best first.
 */
export function buildPhrase(text: string, find: FindSymbols, options: PhraseOptions): PhraseSlot[] {
  const words = splitWords(text);
  const window = options.window ?? 4;
  const limit = options.candidates ?? 12;
  const slots: PhraseSlot[] = [];
  for (let i = 0; i < words.length;) {
    let taken = false;
    for (let k = Math.min(window, words.length - i); k > 1 && !taken; k--) {
      const part = words.slice(i, i + k).join(' ');
      // A trailing space: the query is complete, no type-ahead.
      const hits = find(`${part} `, limit).filter((h) => wholeName(h, k));
      if (hits.length > 0) {
        slots.push({
          text: part,
          words: k,
          candidates: withPreferred(hits, options.preferred),
          chosen: 0,
          functionWord: false,
        });
        i += k;
        taken = true;
      }
    }
    if (taken) continue;
    const word = words[i] as string;
    const functionWord = FUNCTION_WORDS.has(normalizeText(word));
    const candidates = withPreferred(find(`${word} `, limit), options.preferred);
    slots.push({
      text: word,
      words: 1,
      candidates,
      chosen: candidates.length > 0 && !(functionWord && options.skipFunctionWords) ? 0 : null,
      functionWord,
    });
    i += 1;
  }
  return slots;
}
