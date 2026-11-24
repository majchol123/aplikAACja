import { describe, expect, it } from 'vitest';
import fixture from '../test-vectors/grammar.json' with { type: 'json' };
import { GrammarLexicon, parseGrammarData } from './grammar.ts';
import {
  formChoices,
  inflectSentence,
  type GrammarWord,
  type InflectOptions,
  type SpeakerGender,
} from './inflect.ts';
import type { FitzgeraldRole } from './symbols.ts';

const lexicon = new GrammarLexicon(parseGrammarData(fixture));

/** "ty", "iść:verb", "mama:person", "!proszę" (fixed). */
function words(spec: string): GrammarWord[] {
  return spec.split(/\s*\|\s*/).map((w) => {
    const fixed = w.startsWith('!');
    const [label, role] = (fixed ? w.slice(1) : w).split(':');
    return { label: label!, role: (role ?? null) as FitzgeraldRole | null, fixed };
  });
}

const say = (
  spec: string,
  speaker: SpeakerGender | null = null,
  level: InflectOptions['level'] = 'verbs',
) => inflectSentence(words(spec), lexicon, { level, speaker }).join(' ');

describe('grammar lexicon (PLAN §2.10)', () => {
  it('generates forms and reads them back', () => {
    expect(lexicon.forms('iść').filter((f) => f.tag.text === 'fin:sg:pri:imperf')).toEqual([
      expect.objectContaining({ form: 'idę' }),
    ]);
    expect(lexicon.analyze('Chcę').map((a) => [a.lemma, a.tag.text])).toContainEqual([
      'chcieć',
      'fin:sg:pri:imperf',
    ]);
    expect(lexicon.analyze('zosi').map((a) => a.lemma)).toContain('Zosia');
  });

  it('rejects a file of another shape', () => {
    expect(() => parseGrammarData({ v: 2 })).toThrow(/version/);
    expect(() =>
      parseGrammarData({ v: 1, tags: ['x'], paradigms: [['ć', [[1, 'ę']]]], lemmas: [] }),
    ).toThrow(/rule/);
    expect(() =>
      parseGrammarData({ v: 1, tags: ['x'], paradigms: [['ć', [[0, 'ę']]]], lemmas: [['pis', 0]] }),
    ).toThrow(/lemma pis/);
  });
});

describe('inflecting the sentence (G1: verbs)', () => {
  it('says "ja" when there is no subject', () => {
    expect(say('iść:verb')).toBe('idę');
    expect(say('Iść:verb')).toBe('Idę');
    expect(say('chcę:verb | pić:verb')).toBe('chcę pić');
  });

  it('agrees with a pronoun, a person, a name, a pair', () => {
    expect(say('ty:person | iść:verb')).toBe('ty idziesz');
    expect(say('ty:misc | chcę:verb | pić:verb')).toBe('ty chcesz pić');
    expect(say('mama:person | iść:verb')).toBe('mama idzie');
    expect(say('pani:person | iść:verb')).toBe('pani idzie');
    expect(say('Zosia | iść')).toBe('Zosia idzie');
    expect(say('kot:noun | pić:verb')).toBe('kot pije');
    expect(say('ja:person | i | mama:person | iść:verb')).toBe('ja i mama idziemy');
    expect(say('mama:person | i | tata:person | iść:verb')).toBe('mama i tata idą');
    expect(say('my:person | chcę:verb | pić:verb')).toBe('my chcemy pić');
  });

  it('takes things before a verb for objects, not subjects', () => {
    expect(say('mleko:noun | pić:verb')).toBe('mleko piję');
    expect(say('sok:noun | chcę:verb')).toBe('sok chcę');
  });

  it('inflects the verb inside a longer label', () => {
    expect(say('ty | nie chcę:negation')).toBe('ty nie chcesz');
    expect(say('ty | myć zęby:verb')).toBe('ty myjesz zęby');
    expect(say('bawić się:verb')).toBe('bawię się');
    expect(say('ty | boję się:descriptor')).toBe('ty boisz się');
  });

  it('keeps formulas, other persons, experiencer verbs and fixed words', () => {
    expect(say('ty | proszę:social')).toBe('ty proszę');
    expect(say('proszę:social | iść:verb')).toBe('proszę iść');
    expect(say('ty | boli:verb')).toBe('ty boli');
    expect(say('ja | boleć:verb')).toBe('ja boli');
    expect(say('ja | podobać się:verb')).toBe('ja podoba się');
    expect(say('ty | !iść')).toBe('ty iść');
    expect(say('ty | Ja chcę:verb')).toBe('ty Ja chcę');
    expect(say('chcę | żeby | ty | iść:verb')).toBe('chcę żeby ty iść');
  });

  it('repeats the finite form after "i" and starts over at a new pronoun', () => {
    expect(say('jeść:verb | i | pić:verb')).toBe('jem i piję');
    expect(say('ty | jeść:verb | chleb:noun | i | pić:verb')).toBe('ty jesz chleb i pijesz');
    expect(say('chcę:verb | jeść:verb | i | pić:verb')).toBe('chcę jeść i pić');
    expect(say('ja | iść:verb | ty | iść:verb')).toBe('ja idę ty idziesz');
  });

  it('takes the tense from "wczoraj" and "jutro", wherever they stand', () => {
    expect(say('wczoraj | iść:verb')).toBe('wczoraj szedłem');
    expect(say('wczoraj | iść:verb', 'f')).toBe('wczoraj szłam');
    expect(say('iść:verb | wczoraj', 'f')).toBe('szłam wczoraj');
    expect(say('wczoraj | ty | iść:verb')).toBe('wczoraj ty szedłeś');
    expect(say('wczoraj | my | iść:verb')).toBe('wczoraj my szliśmy');
    expect(say('wczoraj | mama | i | tata | iść:verb')).toBe('wczoraj mama i tata szli');
    expect(say('wczoraj | nieść:verb')).toBe('wczoraj niosłem');
    expect(say('wczoraj | boleć:verb')).toBe('wczoraj bolało');
    expect(say('jutro | iść:verb')).toBe('jutro będę iść');
    expect(say('jutro | zjeść:verb')).toBe('jutro zjem');
    expect(say('jutro | być:verb | zmęczony:descriptor', 'f')).toBe('jutro będę zmęczona');
  });

  it('says the preferred variant of a homograph', () => {
    expect(say('dostać:verb')).toBe('dostanę');
  });

  it('makes an adjective on its own agree with the subject', () => {
    expect(say('zmęczony:descriptor', 'f')).toBe('zmęczona');
    expect(say('zmęczony:descriptor')).toBe('zmęczony');
    expect(say('ona | zmęczony:descriptor')).toBe('ona zmęczona');
    expect(say('my | być:verb | zmęczony:descriptor')).toBe('my jesteśmy zmęczeni');
    expect(say('mama:person | zmęczony:descriptor')).toBe('mama zmęczona');
    // Right before a noun it describes the noun: G2.
    expect(say('zmęczony:descriptor | mama:person')).toBe('zmęczony mama');
  });

  it('changes nothing when switched off or without a lexicon', () => {
    expect(say('ty | iść:verb', null, 'off')).toBe('ty iść');
    expect(
      inflectSentence(words('ty | iść:verb'), null, { level: 'verbs', speaker: null }),
    ).toEqual(['ty', 'iść']);
  });
});

describe('choosing a form by hand', () => {
  const groups = (label: string, role: FitzgeraldRole | null = null) =>
    Object.fromEntries(
      formChoices({ label, role, fixed: false }, lexicon).map((g) => [g.title, g.choices]),
    );

  it('lists a verb by tense and person', () => {
    const iść = groups('iść', 'verb');
    expect(Object.keys(iść)).toEqual([
      'Teraz',
      'Wcześniej',
      'Później',
      'Polecenie',
      'Bezokolicznik',
    ]);
    expect(iść.Teraz?.map((c) => c.text)).toEqual([
      'idę',
      'idziesz',
      'idzie',
      'idziemy',
      'idziecie',
      'idą',
    ]);
    expect(iść.Wcześniej?.slice(0, 2)).toEqual([
      { text: 'szedłem', hint: 'ja (on)' },
      { text: 'szłam', hint: 'ja (ona)' },
    ]);
    expect(iść['Później']?.[0]?.text).toBe('będę iść');
    expect(iść.Polecenie?.map((c) => c.text)).toEqual(['idź', 'idźmy', 'idźcie']);
    // A perfective verb has no present: its "fin" forms are the future.
    expect(Object.keys(groups('zjeść', 'verb'))).not.toContain('Teraz');
    expect(groups('myć zęby', 'verb').Teraz?.[1]?.text).toBe('myjesz zęby');
    // A word said earlier comes back from the history in its form.
    expect(groups('idziesz').Teraz?.[0]?.text).toBe('idę');
  });

  it('lists the cases of a noun and the genders of an adjective', () => {
    const chleb = groups('chleb', 'noun');
    expect(chleb.Jeden).toContainEqual({ text: 'chleba', hint: 'kogo? czego?' });
    expect(chleb.Jeden?.[0]).toEqual({ text: 'chleb', hint: 'kto? co? / kogo? co?' });
    expect(groups('zmęczony', 'descriptor')['jaka?']?.[0]?.text).toBe('zmęczona');
    expect(groups('ja', 'person').Jeden?.map((c) => c.text)).toContain('mnie');
    expect(groups('xyz')).toEqual({});
  });
});
