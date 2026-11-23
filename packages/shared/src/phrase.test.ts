import { describe, expect, it } from 'vitest';
import sampleForms from '../test-vectors/sample-forms.json' with { type: 'json' };
import sampleIndex from '../test-vectors/sample-index.json' with { type: 'json' };
import { buildPhrase, splitWords, type FindSymbols } from './phrase.ts';
import { SymbolSearch } from './search.ts';
import { LexiconSchema, SymbolIndexSchema } from './symbols.ts';

const search = new SymbolSearch(
  [SymbolIndexSchema.parse(sampleIndex)],
  [LexiconSchema.parse(sampleForms)],
);
const find: FindSymbols = (query, limit) =>
  search.search(query, { sets: ['arasaac'], hideSexual: true, hideViolence: false, limit });
const options = { skipFunctionWords: false, preferred: new Map<string, string>() };
const chosen = (text: string, opts = options) =>
  buildPhrase(text, find, opts).map((s) => [
    s.text,
    s.chosen === null ? null : s.candidates[s.chosen]?.id,
  ]);

describe('phrase generator (PLAN §2.3)', () => {
  it('splits words like Intl.Segmenter, without punctuation', () => {
    expect(splitWords('Dzień dobry, Ola! Co? 112 — ok.')).toEqual([
      'Dzień',
      'dobry',
      'Ola',
      'Co',
      '112',
      'ok',
    ]);
  });

  it('takes the longest multi-word name, then single words through their lemma', () => {
    expect(chosen('Dzień dobry, Ola, pije sok jabłkowy')).toEqual([
      ['Dzień dobry', 7000],
      ['Ola', 7001],
      ['pije', 6061],
      ['sok jabłkowy', 11403],
    ]);
    expect(chosen('jablka')).toEqual([['jablka', 2462]]);
  });

  it('leaves unknown words and, on request, function words without a symbol', () => {
    expect(chosen('zupa i jabłko')).toEqual([
      ['zupa', null],
      ['i', null],
      ['jabłko', 2462],
    ]);
    const slots = buildPhrase('ciasto z jabłkami', find, { ...options, skipFunctionWords: true });
    // "ciasto z jabłkami" is one name of the cake symbol: kept whole.
    expect(slots.map((s) => [s.text, s.words])).toEqual([['ciasto z jabłkami', 3]]);
  });

  it('puts the preferred variant of a word first', () => {
    expect(chosen('nos')).toEqual([['nos', 2727]]);
    const preferred = new Map([['nos', 'arasaac:30000']]);
    expect(chosen('nos', { ...options, preferred })).toEqual([['nos', 30000]]);
    const [slot] = buildPhrase('nos', find, { ...options, preferred });
    expect(slot?.candidates.map((c) => c.id)).toEqual([30000, 2727]);
  });
});
