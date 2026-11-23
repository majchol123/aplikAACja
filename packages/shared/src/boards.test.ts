import { describe, expect, it } from 'vitest';
import starter from '../../../templates/starter.json' with { type: 'json' };
import {
  freeFolderName,
  SHARED_HOME_NAME,
  CreateTileSchema,
  TemplateSchema,
  TileLabelSchema,
  templateProblems,
  type Template,
} from './boards.ts';
import { subtreePackage } from './obf.ts';

describe('board schemas', () => {
  it('normalizes labels and rejects control characters', () => {
    expect(TileLabelSchema.parse('  Cześć ')).toBe('Cześć');
    expect(TileLabelSchema.parse('Cześć')).toBe('Cześć');
    for (const bad of ['', ' ', 'a\nb', 'a\u0007', 'a\u2028b', '\ud800']) {
      expect(TileLabelSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts a folder grid only on folders', () => {
    const base = { rev: 1, row: 0, col: 0, label: 'x' };
    expect(
      CreateTileSchema.safeParse({ ...base, kind: 'folder', folder: { rows: 2, cols: 2 } }).success,
    ).toBe(true);
    expect(
      CreateTileSchema.safeParse({ ...base, kind: 'word', folder: { rows: 2, cols: 2 } }).success,
    ).toBe(false);
  });
});

describe('templates', () => {
  it('starter template is valid and fits the limits', () => {
    const template = TemplateSchema.parse(starter);
    expect(templateProblems(template)).toEqual([]);
    const folders = template.board.tiles.filter((t) => t.kind === 'folder').map((t) => t.label);
    // PLAN §2.7.
    expect(folders).toEqual([
      'Osoby',
      'Jedzenie',
      'Picie',
      'Uczucia',
      'Ciało',
      'Miejsca',
      'Zabawa',
      'Ubrania',
    ]);
    expect(template.board).toMatchObject({ rows: 4, cols: 6 });
    // The first cell is the app's "Wszystkie symbole".
    expect(template.board.tiles.some((t) => t.row === 0 && t.col === 0)).toBe(false);
  });

  it('reports structural problems', () => {
    const broken: Template = {
      v: 1,
      name: 'T',
      board: {
        rows: 1,
        cols: 2,
        tiles: [
          { row: 0, col: 0, label: 'a' },
          { row: 0, col: 0, label: 'b' },
          { row: 0, col: 2, label: 'c' },
          { row: 0, col: 1, label: 'd', kind: 'folder' },
          { row: 0, col: 1, label: 'e', board: { rows: 1, cols: 1, tiles: [] } },
        ],
      },
    };
    expect(templateProblems(broken)).toEqual([
      'T › b: cell 0,0 taken twice',
      'T › c: outside the grid',
      'T › d: board iff folder',
      'T › e: cell 0,1 taken twice',
      'T › e: board iff folder',
      'T: the first cell is kept for „Wszystkie symbole”',
    ]);
  });
});

describe('names of added folders', () => {
  it('number "Udostępnione" once taken; other names stay as they are', () => {
    expect(freeFolderName('Udostępnione', new Set(['Pulpit']))).toBe('Udostępnione');
    expect(freeFolderName('Udostępnione', new Set(['Udostępnione', 'Udostępnione 2']))).toBe(
      'Udostępnione 3',
    );
    expect(freeFolderName('Jedzenie', new Set(['Jedzenie']))).toBe('Jedzenie');
  });

  it('a home board travels as "Udostępnione", any other board under its own name', () => {
    const board = (id: string, name: string, parentId: string | null) => ({
      id,
      name,
      parentId,
      rows: 1,
      cols: 1,
      rev: 1,
      tiles: [],
    });
    const boards = new Map([
      ['h', board('h', 'Pulpit', null)],
      ['f', board('f', 'Jedzenie', 'h')],
    ]);
    expect(subtreePackage(boards, 'h')!.package.name).toBe(SHARED_HOME_NAME);
    expect(subtreePackage(boards, 'f')!.package.name).toBe('Jedzenie');
  });
});
