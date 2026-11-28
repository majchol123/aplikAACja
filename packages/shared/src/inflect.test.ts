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

  it('joins the files of several sets, the first winning', () => {
    const extra = parseGrammarData({
      v: 1,
      tags: ['subst:sg:acc:f', 'subst:sg:nom:f'],
      paradigms: [
        [
          'a',
          [
            [0, 'ę'],
            [1, 'a'],
          ],
        ],
      ],
      lemmas: [
        ['hulajnoga', 0],
        ['mama', 0],
      ],
      animate: ['hulajnoga'],
    });
    const both = new GrammarLexicon(parseGrammarData(fixture), extra);
    expect(both.forms('hulajnoga').map((f) => f.form)).toEqual(['hulajnogę', 'hulajnoga']);
    expect(both.analyze('hulajnogę').map((a) => a.lemma)).toEqual(['hulajnoga']);
    expect(both.animate('hulajnoga') && both.animate('mama')).toBe(true);
    // "mama" keeps every form of the mirror's file.
    expect(both.forms('mama').length).toBe(lexicon.forms('mama').length);
    const words = [
      { label: 'lubić', role: 'verb' as const, fixed: false },
      { label: 'hulajnoga', role: 'noun' as const, fixed: false },
    ];
    expect(inflectSentence(words, both, { level: 'full', speaker: null })).toEqual([
      'lubię',
      'hulajnogę',
    ]);
  });

  it('rejects a file of another shape', () => {
    expect(() => parseGrammarData({ v: 2 })).toThrow(/version/);
    expect(() =>
      parseGrammarData({ v: 1, tags: ['x'], paradigms: [['ć', [[1, 'ę']]]], lemmas: [] }),
    ).toThrow(/rule/);
    expect(() =>
      parseGrammarData({ v: 1, tags: ['x'], paradigms: [['ć', [[0, 'ę']]]], lemmas: [['pis', 0]] }),
    ).toThrow(/lemma pis/);
    expect(() =>
      parseGrammarData({ v: 1, tags: [], paradigms: [], lemmas: [], animate: [1] }),
    ).toThrow(/animate/);
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

  it('takes people and animals of any gender for subjects (animate list)', () => {
    // ARASAAC gives "mama", "nauczycielka" the role "noun", not "person".
    expect(say('mama:noun | iść:verb')).toBe('mama idzie');
    expect(say('nauczycielka:noun | iść:verb')).toBe('nauczycielka idzie');
    expect(say('krowa:noun | iść:verb')).toBe('krowa idzie');
    expect(say('mysz:noun | uciekać:verb')).toBe('mysz ucieka');
    expect(say('dziecko:noun | spać:verb')).toBe('dziecko śpi');
    expect(say('wczoraj | krowa:noun | iść:verb', 'f')).toBe('wczoraj krowa szła');
    expect(say('krowa:noun | zmęczony:descriptor')).toBe('krowa zmęczona');
    expect(say('krowa:noun | i | owca:noun | jeść:verb')).toBe('krowa i owca jedzą');
    // The table drops what the categories bring in wrongly; the rest stay objects.
    expect(say('dom:noun | iść:verb')).toBe('dom idę');
    expect(say('ogon:noun | mieć:verb')).toBe('ogon mam');
    // Role "person" names someone even when the lexicon lacks the word.
    expect(say('Burek:person | iść:verb')).toBe('Burek idzie');
    expect(say('wczoraj | Hania:person | iść:verb')).toBe('wczoraj Hania szła');
  });

  it('prefers a pronoun, else the first one naming someone', () => {
    expect(say('ja:person | pies:noun | karmić:verb')).toBe('ja pies karmię');
    expect(say('pies:noun | ty:person | karmić:verb')).toBe('pies ty karmisz');
    expect(say('mama:person | tata:person | kochać:verb')).toBe('mama tata kocha');
    expect(say('z | mamą | ty:person | iść:verb')).toBe('z mamą ty idziesz');
    expect(say('mama:noun | i | ja:person | iść:verb')).toBe('mama i ja idziemy');
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

describe('inflecting the sentence (G2: cases)', () => {
  const full = (spec: string, speaker: SpeakerGender | null = null) => say(spec, speaker, 'full');

  it('puts objects in the case the verb takes', () => {
    expect(full('lubić:verb | piłka:noun')).toBe('lubię piłkę');
    expect(full('chcę:verb | woda:noun')).toBe('chcę wody');
    expect(full('ty | mieć:verb | kot:noun')).toBe('ty masz kota');
    expect(full('szukać:verb | mama:noun')).toBe('szukam mamy');
    expect(full('pomagać:verb | tata:person')).toBe('pomagam tacie');
    expect(full('dać:verb | mama:noun | piłka:noun')).toBe('dam mamie piłkę');
    expect(full('dać:verb | piłka:noun | mama:noun')).toBe('dam piłkę mamie');
    expect(full('jechać:verb | autobus:noun')).toBe('jadę autobusem');
    expect(full('jechać:verb | mama:noun')).toBe('jadę mama');
    expect(full('bawić się:verb | lalka:noun')).toBe('bawię się lalką');
  });

  it('takes the object before the verb too, and the subject stays', () => {
    expect(full('woda:noun | chcę:verb')).toBe('wody chcę');
    expect(full('ja | pies:noun | karmić:verb')).toBe('ja psa karmię');
    expect(full('mama:noun | kot:noun | karmić:verb')).toBe('mama kota karmi');
    expect(full('mleko:noun | pić:verb')).toBe('mleko piję');
  });

  it('turns the accusative into the genitive after "nie"', () => {
    expect(full('nie | lubić:verb | piłka:noun')).toBe('nie lubię piłki');
    expect(full('nie chcę:negation | woda:noun')).toBe('nie chcę wody');
    expect(full('nie | pomagać:verb | mama:noun')).toBe('nie pomagam mamie');
  });

  it('gives a noun after a preposition its case', () => {
    expect(full('iść:verb | do | szkoła:noun')).toBe('idę do szkoły');
    expect(full('być:verb | w | dom:noun')).toBe('jestem w domu');
    expect(full('iść:verb | na | plac:noun')).toBe('idę na plac');
    expect(full('iść:verb | na | spacer:noun')).toBe('idę na spacer');
    expect(full('bawić się:verb | z | mama:noun')).toBe('bawię się z mamą');
    expect(full('wracać:verb | z | szkoła:noun')).toBe('wracam ze szkoły');
    expect(full('czekać:verb | na | tata:person')).toBe('czekam na tatę');
    expect(full('grać:verb | w | piłka:noun')).toBe('gram w piłkę');
    expect(full('położyć:verb | lalka:noun | na | stół:noun')).toBe('położę lalkę na stół');
    expect(full('książka:noun | dla | mama:noun')).toBe('książka dla mamy');
  });

  it('makes adjectives agree with their noun, before or after it', () => {
    expect(full('lubić:verb | duży:descriptor | piłka:noun')).toBe('lubię dużą piłkę');
    expect(full('lubić:verb | piłka:noun | czerwony:descriptor')).toBe('lubię piłkę czerwoną');
    expect(full('duży:descriptor | pies:noun | jeść:verb')).toBe('duży pies je');
    expect(full('mała:descriptor | krowa:noun')).toBe('mała krowa');
    expect(full('iść:verb | do | duży:descriptor | dom:noun')).toBe('idę do dużego domu');
    expect(full('chcę:verb | zimny:descriptor | woda:noun')).toBe('chcę zimnej wody');
  });

  it('counts with numerals', () => {
    expect(full('mieć:verb | dwa | piłka:noun')).toBe('mam dwie piłki');
    expect(full('mieć:verb | pięć | piłka:noun')).toBe('mam pięć piłek');
    expect(full('mieć:verb | 2 | kot:noun')).toBe('mam 2 koty');
    expect(full('dwa | kot:noun | jeść:verb')).toBe('dwa koty jedzą');
    expect(full('pięć | kot:noun | jeść:verb')).toBe('pięć kotów je');
    expect(full('dwa | chłopiec:noun | iść:verb')).toBe('dwaj chłopcy idą');
    expect(full('dwa | dziecko:noun | spać:verb')).toBe('dwoje dzieci śpi');
    expect(full('mieć:verb | jeden | piłka:noun')).toBe('mam jedną piłkę');
  });

  it('says pronouns as objects', () => {
    expect(full('lubić:verb | ty')).toBe('lubię cię');
    expect(full('mama:person | kochać:verb | ja')).toBe('mama kocha mnie');
    expect(full('dać:verb | on | piłka:noun')).toBe('dam mu piłkę');
    expect(full('iść:verb | z | ty')).toBe('idę z tobą');
    expect(full('iść:verb | do | on')).toBe('idę do niego');
    expect(full('bawić się:verb | z | ja')).toBe('bawię się ze mną');
    expect(full('lubić:verb | pani')).toBe('lubię panią');
    // Followed by a verb, a pronoun still starts a clause of its own.
    expect(full('ja | iść:verb | ty | iść:verb')).toBe('ja idę ty idziesz');
  });

  it('puts the noun after "być" in the instrumental, unless "to" is the subject', () => {
    expect(full('ja | być:verb | lekarz:noun')).toBe('ja jestem lekarzem');
    expect(full('mama:noun | być:verb | nauczycielka:noun')).toBe('mama jest nauczycielką');
    expect(full('to | być:verb | piłka:noun')).toBe('to jest piłka');
    expect(full('piłka:noun | być:verb | czerwony:descriptor')).toBe('piłka jest czerwona');
  });

  it('lets a thing be the subject of a verb a thing may do', () => {
    expect(full('deszcz:noun | padać:verb')).toBe('deszcz pada');
    expect(say('słońce:noun | świecić:verb')).toBe('słońce świeci');
  });

  it('handles idioms, containers, variants and requests', () => {
    expect(full('mieć:verb | na | imię:noun | Ola')).toBe('mam na imię Ola');
    expect(full('pić:verb | z | kubek:noun')).toBe('piję z kubka');
    expect(full('pić:verb | herbata:noun | z | cukier:noun')).toBe('piję herbatę z cukrem');
    expect(full('chcę:verb | dwa | lody:noun')).toBe('chcę dwóch lodów');
    expect(full('lubić:verb | mój | pies:noun')).toBe('lubię mojego psa');
    expect(full('po | obiad:noun | iść:verb | spać:verb')).toBe('po obiedzie idę spać');
    // The speaker as the object asks someone; an object form already written fills its slot.
    expect(full('pomóc:verb | ja')).toBe('pomóż mi');
    expect(full('dać:verb | ja | jabłko:noun')).toBe('daj mi jabłko');
    expect(full('!daj | mi | piłka:noun')).toBe('daj mi piłkę');
    expect(full('mama:noun | dać:verb | ja | jabłko:noun')).toBe('mama da mi jabłko');
    // A determiner in any form and whatever its role agrees; a tool takes the instrumental.
    expect(full('szukać:verb | moja:misc | piłka:noun')).toBe('szukam mojej piłki');
    expect(full('lubić:verb | ten | pies:noun')).toBe('lubię tego psa');
    expect(full('myć:verb | ręka:noun | mydło:noun')).toBe('myję rękę mydłem');
    expect(full('mieć:verb | sen:noun')).toBe('mam sen');
    expect(full('nie | ma | mama:noun')).toBe('nie ma mamy');
    expect(full('lubić:verb | sport:noun')).toBe('lubię sport');
    // Not in the dictionary form, an adjective on its own stays as written.
    expect(say('ja | zmęczona:descriptor', 'm')).toBe('ja zmęczona');
  });

  it('leaves alone what it is unsure of', () => {
    // No entry in the table: the noun stays.
    expect(full('iść:verb | mama:noun')).toBe('idę mama');
    // The verbs level does no cases.
    expect(say('lubić:verb | piłka:noun')).toBe('lubię piłka');
    expect(full('!kocham | mama:noun')).toBe('kocham mamę');
    expect(full('myć zęby:verb | mama:noun')).toBe('myję zęby mama');
  });
});

describe('own words of the tiles (G3)', () => {
  const w = (label: string, role: FitzgeraldRole | null, extra: Partial<GrammarWord> = {}) => ({
    label,
    role,
    fixed: false,
    ...extra,
  });
  const full = (words: GrammarWord[]) =>
    inflectSentence(words, lexicon, { level: 'full', speaker: 'f' }).join(' ');

  it('inflects a word the lexicon lacks like another one', () => {
    expect(full([w('lubić', 'verb'), w('hulajnoga', 'noun', { like: 'noga' })])).toBe(
      'lubię hulajnogę',
    );
    expect(full([w('iść', 'verb'), w('z', null), w('Basia', 'person', { like: 'Kasia' })])).toBe(
      'idę z Basią',
    );
    expect(full([w('Basia', 'person', { like: 'Kasia' }), w('iść', 'verb')])).toBe('Basia idzie');
    // Not ending as "noga" does: left as it is.
    expect(full([w('lubić', 'verb'), w('rower', 'noun', { like: 'noga' })])).toBe('lubię rower');
    expect(lexicon.ownWordFits('hulajnoga', 'noga')).toBe(true);
    expect(lexicon.ownWordFits('kot', 'noga')).toBe(false);
    // The lexicon itself is not changed.
    expect(lexicon.has('hulajnoga')).toBe(false);
  });

  it('takes the user’s word on who may be the subject, and on not inflecting', () => {
    expect(full([w('lalka', 'noun'), w('spać', 'verb')])).toBe('lalka śpię');
    expect(full([w('lalka', 'noun', { someone: true }), w('spać', 'verb')])).toBe('lalka śpi');
    expect(full([w('mama', 'noun', { someone: false }), w('iść', 'verb')])).toBe('mama idę');
    expect(full([w('Burek', 'noun', { someone: true }), w('spać', 'verb')])).toBe('Burek śpi');
    expect(full([w('iść', 'verb', { fixed: true })])).toBe('iść');
    expect(full([w('chcieć', 'verb'), w('sok', 'noun', { fixed: true })])).toBe('chcę sok');
    expect(full([w('lubić', 'verb'), w('piłki', 'noun', { fixed: true })])).toBe('lubię piłki');
  });

  it('proposes words to inflect like, and offers the own word’s forms', () => {
    expect(lexicon.suggestLike('hulajnoga', 'subst')).toContain('noga');
    expect(lexicon.suggestLike('Basia')).toContain('Kasia');
    const groups = formChoices(w('hulajnoga', 'noun', { like: 'noga' }), lexicon);
    expect(groups.find((g) => g.title === 'Jeden')?.choices.map((c) => c.text)).toContain(
      'hulajnogę',
    );
  });
});
