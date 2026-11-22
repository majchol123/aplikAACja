import { describe, expect, it } from 'vitest';
import { labelMatches, PatchMediaSchema } from './media.ts';

describe('own photos', () => {
  it('match a search by the starts of their name words, like library keywords', () => {
    expect(labelMatches('Mama Ania', 'mam')).toBe(true);
    expect(labelMatches('Mama Ania', 'ani mama')).toBe(true);
    expect(labelMatches('Łóżko w pokoju', 'lozk')).toBe(true);
    expect(labelMatches('Mama Ania', 'nia')).toBe(false);
    expect(labelMatches('Mama Ania', 'tata')).toBe(false);
    expect(labelMatches('Mama', '  ')).toBe(false);
  });

  it('names are tile labels', () => {
    expect(PatchMediaSchema.safeParse({ label: ' Babcia ' }).data).toEqual({ label: 'Babcia' });
    expect(PatchMediaSchema.safeParse({ label: '' }).success).toBe(false);
    expect(PatchMediaSchema.safeParse({ label: 'x'.repeat(81) }).success).toBe(false);
    expect(PatchMediaSchema.safeParse({ label: 'a', mime: 'image/svg+xml' }).success).toBe(false);
  });
});
