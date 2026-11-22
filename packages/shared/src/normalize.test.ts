import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors/normalize.json' with { type: 'json' };
import { normalizeText, tokenize } from './normalize.ts';

describe('normalizeText (shared vectors with the Python tools)', () => {
  for (const { in: input, out } of vectors.cases) {
    it(JSON.stringify(input), () => expect(normalizeText(input)).toBe(out));
  }
});

describe('tokenize', () => {
  it('splits normalized words', () =>
    expect(tokenize(' Ciasto z jabłkami! ')).toEqual(['ciasto', 'z', 'jablkami']));
  it('returns no tokens for punctuation only', () => expect(tokenize('?!')).toEqual([]));
});
