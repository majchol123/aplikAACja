import { describe, expect, it } from 'vitest';
import sampleCategories from '../test-vectors/sample-categories.json' with { type: 'json' };
import sampleIndex from '../test-vectors/sample-index.json' with { type: 'json' };
import { CategoryTree } from './categories.ts';
import {
  CategoryFileSchema,
  SymbolIndexSchema,
  type CategoryFile,
  type SymbolFilter,
  type SymbolIndex,
} from './symbols.ts';

// Built by tools/tests from the fixture tree: Odżywianie się → Jedzenie → Owoce, Deser;
// → Napój; Organizmy żywe → Twarz; Komunikacja → Powitanie, Czasownik; Seksualność.
const index = SymbolIndexSchema.parse(sampleIndex);
const file = CategoryFileSchema.parse(sampleCategories);
const tree = new CategoryTree(file, index);

const DEFAULT: SymbolFilter = { hideSexual: true, hideViolence: false };
const NONE: SymbolFilter = { hideSexual: false, hideViolence: false };
const BOTH: SymbolFilter = { hideSexual: true, hideViolence: true };

const idOf = (name: string) => {
  const node = file.nodes.find((n) => n.n === name);
  if (!node) throw new Error(name);
  return node.id;
};
const folders = (id: number | null, filter = DEFAULT) =>
  tree.view(id, filter)?.folders.map((f) => `${f.name}:${f.count}`);
const labels = (id: number, filter = DEFAULT) => tree.view(id, filter)?.symbols.map((s) => s.label);

describe('CategoryTree', () => {
  it('shows the top level in the order of the set, without folders the filter empties', () => {
    // "sok jabłkowy" is in Owoce and Napój: counted once for Odżywianie się.
    expect(folders(null)).toEqual(['Odżywianie się:4', 'Organizmy żywe:2', 'Komunikacja:3']);
    expect(folders(null, BOTH)).toEqual(['Odżywianie się:4', 'Organizmy żywe:2', 'Komunikacja:2']);
    expect(folders(null, NONE)).toContain('Seksualność:1');
    expect(tree.view(null, DEFAULT)).toMatchObject({ set: 'arasaac', id: null, path: [] });
  });

  it('opens a folder: subfolders, own symbols alphabetically, path from the top', () => {
    const food = idOf('Odżywianie się');
    expect(folders(food)).toEqual(['Jedzenie:3', 'Napój:2']);
    expect(labels(food)).toEqual([]);

    const fruit = tree.view(idOf('Owoce'), DEFAULT);
    expect(fruit?.path.map((p) => p.name)).toEqual(['Odżywianie się', 'Jedzenie', 'Owoce']);
    expect(fruit?.folders).toEqual([]);
    expect(fruit?.symbols.map((s) => s.label)).toEqual(['jabłko', 'sok jabłkowy']);
    expect(fruit?.symbols[0]).toMatchObject({ set: 'arasaac', id: 2462, role: 'noun' });
    expect(fruit?.symbols[0]?.src).toMatch(/^\/sym\/arasaac\/p\/2462\.[0-9a-f]{8}\.webp$/);
  });

  it('applies the content filter to the symbols of a folder', () => {
    const verbs = idOf('Czasownik');
    expect(labels(verbs, NONE)).toEqual(['bić', 'pić']);
    expect(labels(verbs, BOTH)).toEqual(['pić']);
    expect(labels(idOf('Seksualność'), DEFAULT)).toEqual([]);
  });

  it('uses the icon chosen by the build, or another visible symbol when it is filtered', () => {
    const top = tree.view(null, DEFAULT)?.folders.find((f) => f.name === 'Komunikacja');
    expect(top?.icon).toMatch(/\/p\/\d+\./);

    const custom: CategoryFile = {
      v: 1,
      set: 'arasaac',
      nodes: [{ id: idOf('Czasownik'), n: 'Czasownik', i: 5001 }],
    };
    const icons = (filter: SymbolFilter) =>
      new CategoryTree(custom, index).view(null, filter)?.folders[0]?.icon;
    expect(icons(NONE)).toMatch(/\/p\/5001\./);
    expect(icons(BOTH)).toMatch(/\/p\/6061\./);
  });

  it('serves own folder icons of a set and ignores folder ids the tree does not know', () => {
    const extra: SymbolIndex = {
      v: 1,
      set: 'extra',
      name: 'Dodatkowy',
      items: [
        { id: 1, f: 'x/1.0000abcd.webp', k: ['jabłko'], r: 'noun', g: [7, 99] },
        { id: 2, f: 'x/2.0000abcd.webp', k: ['banan'], r: 'noun', g: [7] },
      ],
    };
    const extraTree = new CategoryTree(
      { v: 1, set: 'extra', nodes: [{ id: 7, n: 'Owoce', f: 'g/7.0000abcd.webp' }] },
      extra,
    );
    expect(extraTree.view(null, DEFAULT)?.folders).toEqual([
      {
        id: 7,
        key: null,
        name: 'Owoce',
        icon: '/sym/extra/g/7.0000abcd.webp',
        ownIcon: true,
        custom: false,
        count: 2,
      },
    ]);
    expect(extraTree.view(7, DEFAULT)?.symbols.map((s) => s.label)).toEqual(['banan', 'jabłko']);
    expect(extraTree.view(99, DEFAULT)).toBeNull();
    expect(extraTree.has(7)).toBe(true);
  });

  it("uses an admin's folder picture unless the filter hides it or the set lost it", () => {
    const verbs = idOf('Czasownik');
    const folder = (icons: Map<string, number>, filter = DEFAULT) =>
      tree.view(idOf('Komunikacja'), filter, icons)?.folders.find((f) => f.id === verbs);
    expect(folder(new Map())).toMatchObject({ key: 'verb', custom: false });
    expect(folder(new Map([['verb', 5001]]))).toMatchObject({ custom: true });
    expect(folder(new Map([['verb', 5001]]))?.icon).toMatch(/\/p\/5001\./);
    // "bić" is hidden by the violence filter, 424242 is not in the set: automatic picture.
    expect(folder(new Map([['verb', 5001]]), BOTH)).toMatchObject({ custom: false });
    expect(folder(new Map([['verb', 424242]]))).toMatchObject({ custom: false });
    expect(folder(new Map([['verb', 424242]]))?.icon).toMatch(/\/p\/6061\./);

    const open = tree.view(verbs, DEFAULT, new Map([['verb', 5001]]));
    expect(open?.folder).toMatchObject({ id: verbs, key: 'verb', name: 'Czasownik', custom: true });
    expect(tree.view(null, DEFAULT)?.folder).toBeNull();
  });

  it('rejects trees whose parents come late, repeat ids or belong to another set', () => {
    const late: CategoryFile = {
      v: 1,
      set: 'arasaac',
      nodes: [
        { id: 2, n: 'Owoce', p: 1 },
        { id: 1, n: 'Jedzenie' },
      ],
    };
    expect(() => new CategoryTree(late, index)).toThrow(/before its parent/);
    const repeated: CategoryFile = {
      v: 1,
      set: 'arasaac',
      nodes: [
        { id: 1, n: 'A' },
        { id: 1, n: 'B' },
      ],
    };
    expect(() => new CategoryTree(repeated, index)).toThrow(/repeated/);
    expect(() => new CategoryTree({ ...file, set: 'extra' }, index)).toThrow(/categories of/);
  });

  it('accepts only icon files inside the set directory', () => {
    const icon = (f: string) =>
      CategoryFileSchema.safeParse({ v: 1, set: 'extra', nodes: [{ id: 1, n: 'A', f }] }).success;
    expect(icon('g/1.0000abcd.webp')).toBe(true);
    expect(icon('../g/1.0000abcd.webp')).toBe(false);
    expect(icon('g/1.0000abcd.svg')).toBe(false);
    expect(icon('/api/media/1')).toBe(false);
  });
});
