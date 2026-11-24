/**
 * Inflecting the sentence bar (PLAN §2.10, F8): words keep their tiles' labels, the sentence
 * is said and shown in agreeing forms. Without a subject the speaker is "ja": "iść" → "idę",
 * "ty" + "iść" → "idziesz". Conservative on purpose — a wrong form changes what the user says,
 * so whatever is unclear stays as on the tile and the user can pick a form by hand.
 */
import { matchCase, type Analysis, type Form, type GrammarLexicon, type Tag } from './grammar.ts';
import type { FitzgeraldRole } from './symbols.ts';

/** "full" (cases after verbs and prepositions, G2) joins once it is built. */
export const GRAMMAR_LEVELS = ['off', 'verbs'] as const;
export type GrammarLevel = (typeof GRAMMAR_LEVELS)[number];
export const SPEAKER_GENDERS = ['m', 'f'] as const;
export type SpeakerGender = (typeof SPEAKER_GENDERS)[number];

/** A word of the sentence bar as the grammar sees it. */
export interface GrammarWord {
  /** The tile's label (or the symbol's word): the base its form is made from. */
  label: string;
  /** Fitzgerald role of the tile or symbol; tells "mam" (mieć) from "mam" (mama). */
  role: FitzgeraldRole | null;
  /**
   * Said exactly as it is: a tile's own words (Tile.speech), history, favourites, the phrase
   * generator, a form picked by hand. Still counts as a subject or as the clause's verb.
   */
  fixed: boolean;
}

export interface InflectOptions {
  level: GrammarLevel;
  /** How the user speaks of themselves in the past tense and with adjectives; null: masculine. */
  speaker: SpeakerGender | null;
}

type Gender = 'm1' | 'm2' | 'm3' | 'f' | 'n';
interface Agreement {
  person: 1 | 2 | 3;
  plural: boolean;
  /** Singular: the noun's gender; plural: m1 (masculine personal) or f for every other. */
  gender: Gender;
}
type Tense = 'present' | 'past' | 'future';

// --- closed word lists ------------------------------------------------------------

/** Nominative personal pronouns; "pan", "pani" take the 3rd person ("pani idzie"). */
const PRONOUNS: Record<string, Agreement | 'speaker'> = {
  ja: 'speaker',
  ty: { person: 2, plural: false, gender: 'm1' },
  on: { person: 3, plural: false, gender: 'm1' },
  ona: { person: 3, plural: false, gender: 'f' },
  ono: { person: 3, plural: false, gender: 'n' },
  my: { person: 1, plural: true, gender: 'm1' },
  wy: { person: 2, plural: true, gender: 'm1' },
  oni: { person: 3, plural: true, gender: 'm1' },
  one: { person: 3, plural: true, gender: 'f' },
  pan: { person: 3, plural: false, gender: 'm1' },
  pani: { person: 3, plural: false, gender: 'f' },
  państwo: { person: 3, plural: true, gender: 'm1' },
};

const TENSE_WORDS: Record<string, Tense> = {
  wczoraj: 'past',
  przedwczoraj: 'past',
  wcześniej: 'past',
  przedtem: 'past',
  dawniej: 'past',
  teraz: 'present',
  dzisiaj: 'present',
  dziś: 'present',
  jutro: 'future',
  pojutrze: 'future',
  później: 'future',
  potem: 'future',
  wkrótce: 'future',
  niedługo: 'future',
};

/** Words between two clauses: a new subject and verb may follow. */
const SEPARATORS = new Set([
  'że',
  'bo',
  'a',
  'ale',
  'kiedy',
  'gdy',
  'jeśli',
  'jeżeli',
  'ponieważ',
  'więc',
  'czy',
]);
/** After these the verb takes forms the app does not build ("żeby mama przyszła"): left alone. */
const SUBJUNCTIVE = new Set(['żeby', 'aby', 'by', 'żebym', 'żebyś']);

/** Formulas said as they are, whatever the subject ("ty" + "proszę" stays "proszę"). */
const FORMULAS = new Set([
  'proszę',
  'dziękuję',
  'przepraszam',
  'pomocy',
  'tak',
  'nie',
  'cześć',
  'hej',
  'halo',
  'dobrze',
  'ok',
  'okej',
  'dzień dobry',
  'do widzenia',
  'dobranoc',
  'na razie',
  'smacznego',
  'sto lat',
]);

/**
 * Verbs whose experiencer is not the subject ("podoba mi się", "boli mnie"): never take the
 * speaker's person — "ja" + "podobać się" would say "podobam się" ('I am liked').
 */
const EXPERIENCER = new Set(['podobać się', 'smakować', 'boleć', 'chcieć się', 'brakować']);

/** Labels naming the other sense of a homograph: the verb's forms starting with this. */
const SENSES: Record<string, string> = {
  'paść się': 'pas',
  'posłać łóżko': 'pości',
};

const PREPOSITIONS = new Set([
  'do',
  'od',
  'z',
  'ze',
  'w',
  'we',
  'na',
  'o',
  'po',
  'przy',
  'u',
  'dla',
  'bez',
  'pod',
  'nad',
  'za',
  'przed',
  'między',
  'obok',
  'koło',
  'przez',
  'około',
  'wokół',
]);

/** Roles of words that are never inflected (greetings, questions, little words). */
const FIXED_ROLES = new Set<FitzgeraldRole>(['social', 'question', 'misc']);

// --- tags -----------------------------------------------------------------------------

const has = (tag: Tag, i: number, value: string) => tag.attrs[i]?.includes(value) ?? false;
const isNeuter = (tag: Tag, i: number) =>
  has(tag, i, 'n') || has(tag, i, 'n1') || has(tag, i, 'n2');

/** Aspect of a verb tag (the last attribute of fin/inf/praet/…); biaspectual counts as imperf. */
function perfective(tag: Tag): boolean {
  return tag.attrs.some((a) => a.includes('perf') && !a.includes('imperf'));
}

const PERSON_TAG = { 1: 'pri', 2: 'sec', 3: 'ter' } as const;

/** Number and person of fin / bedzie / impt. */
const personTag = (tag: Tag, a: Agreement) =>
  has(tag, 0, a.plural ? 'pl' : 'sg') && has(tag, 1, PERSON_TAG[a.person]);

/** Gender of praet / adj in the singular or plural. */
function genderTag(tag: Tag, i: number, a: Agreement): boolean {
  if (a.plural) return a.gender === 'm1' ? has(tag, i, 'm1') : has(tag, i, 'f');
  if (a.gender === 'f') return has(tag, i, 'f');
  if (a.gender === 'n') return isNeuter(tag, i);
  return has(tag, i, 'm1') || has(tag, i, 'm2') || has(tag, i, 'm3');
}

function nounAgreement(tag: Tag): Agreement {
  const plural = has(tag, 0, 'pl');
  const g = tag.attrs[2] ?? [];
  if (plural)
    return { person: 3, plural, gender: g.includes('m1') || g.includes('p1') ? 'm1' : 'f' };
  const gender: Gender = g.includes('m1')
    ? 'm1'
    : g.includes('m2')
      ? 'm2'
      : g.includes('m3')
        ? 'm3'
        : g.includes('f')
          ? 'f'
          : 'n';
  return { person: 3, plural, gender };
}

function combine(first: Agreement, partners: Agreement[]): Agreement {
  if (partners.length === 0) return first;
  const members = [first, ...partners];
  const person = Math.min(...members.map((m) => m.person)) as 1 | 2 | 3;
  const personal = members.some((m) => m.gender === 'm1');
  return { person, plural: true, gender: personal ? 'm1' : 'f' };
}

// --- reading a word ---------------------------------------------------------------------

interface Token {
  /** As written, with punctuation around it. */
  raw: string;
  /** Letters only: what the lexicon reads. */
  core: string;
}

function tokenize(label: string): Token[] {
  return label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, core: raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') }));
}

/** An inflectable verb or adjective: which token of the label and its lemma. */
interface Head {
  at: number;
  lemma: string;
  perfective: boolean;
  experiencer: boolean;
  sense: string | undefined;
}

interface WordInfo {
  tokens: Token[];
  verb?: Head;
  adjective?: Head;
  /** Can be the subject: a nominative pronoun, a person, an animal, a name. */
  subject?: Agreement;
  /** A noun in the nominative (an adjective right before it is attributive). */
  noun?: boolean;
  /** Agreement of a nominative noun: a partner of the subject in "mama i tata". */
  nominal?: Agreement;
  /** Occupies the clause's verb without being inflected ("proszę", "boli", a picked form). */
  finite?: boolean;
  tense?: Tense;
  /** A word between clauses ("że", "bo", …); subjunctive: what follows is left alone. */
  separator?: 'clause' | 'subjunctive';
  /** Ends its clause (".", "?", "!", ","). */
  endsClause?: boolean;
  and?: boolean;
  preposition?: boolean;
}

const FINITE_POS = new Set(['fin', 'praet', 'bedzie', 'impt']);

function readWord(word: GrammarWord, lexicon: GrammarLexicon, speaker: Agreement): WordInfo {
  const tokens = tokenize(word.label);
  const info: WordInfo = { tokens };
  const text = tokens
    .map((t) => t.core.toLowerCase())
    .filter(Boolean)
    .join(' ');
  if (/[.!?;,]\s*$/.test(word.label)) info.endsClause = true;
  if (SEPARATORS.has(text)) info.separator = 'clause';
  if (SUBJUNCTIVE.has(text)) info.separator = 'subjunctive';
  if (text === 'i') info.and = true;
  if (PREPOSITIONS.has(text)) info.preposition = true;
  const tense = tokens.map((t) => TENSE_WORDS[t.core.toLowerCase()]).find(Boolean);
  if (tense) info.tense = tense;
  if (info.separator || info.and || info.preposition || tense) return info;

  const pronoun = PRONOUNS[text];
  if (pronoun) {
    info.subject = pronoun === 'speaker' ? speaker : pronoun;
    return info;
  }

  const readings = tokens.map((t) => (t.core ? lexicon.analyze(t.core) : []));
  const finiteReading = readings.some((r) => r.some((a) => FINITE_POS.has(a.tag.pos)));
  // "Ja chcę": the label brings its own subject, so it stays as it is.
  const own =
    tokens.length > 1 ? tokens.map((t) => PRONOUNS[t.core.toLowerCase()]).find(Boolean) : undefined;
  const ownSubject = own !== undefined;
  if (word.fixed || FORMULAS.has(text) || (word.role && FIXED_ROLES.has(word.role)) || ownSubject) {
    if (finiteReading) info.finite = true;
    if (own) info.subject = own === 'speaker' ? speaker : own;
    const noun = nounReading(readings[0] ?? [], word.role, lexicon, tokens[0]?.core ?? '');
    if (noun && !ownSubject) Object.assign(info, noun);
    return info;
  }

  const role = word.role;
  const verbAllowed = role !== 'noun' && role !== 'person';
  if (verbAllowed) {
    const verb = verbHead(tokens, readings, text);
    if (verb) {
      info.verb = verb;
      return info;
    }
    // Another finite form ("boli", "idzie", "chodź"): said as it is, and the clause's verb.
    if (finiteReading && role !== 'descriptor') {
      info.finite = true;
      return info;
    }
  }
  if (role === null || role === 'descriptor') {
    const adjective = adjectiveHead(tokens, readings);
    if (adjective) {
      info.adjective = adjective;
      return info;
    }
  }
  if (finiteReading && role === 'descriptor') info.finite = true;
  const noun = nounReading(readings[0] ?? [], role, lexicon, tokens[0]?.core ?? '');
  if (noun) Object.assign(info, noun);
  return info;
}

/**
 * The label's first token that is a verb's infinitive or its 1st person singular — or, for
 * picking a form by hand, any form of a verb ("idziesz" from the history).
 */
function verbHead(
  tokens: Token[],
  readings: (readonly Analysis[])[],
  text: string,
  anyForm = false,
): Head | undefined {
  for (const [at, token] of tokens.entries()) {
    const lower = token.core.toLowerCase();
    const reading = readings[at]?.find(
      (a) =>
        (a.tag.pos === 'inf' && a.lemma.toLowerCase() === lower) ||
        (a.tag.pos === 'fin' && has(a.tag, 0, 'sg') && has(a.tag, 1, 'pri')) ||
        (anyForm && FINITE_POS.has(a.tag.pos)),
    );
    if (!reading) continue;
    const reflexive = tokens.some((t) => t.core.toLowerCase() === 'się');
    return {
      at,
      lemma: reading.lemma,
      perfective: perfective(reading.tag),
      experiencer:
        EXPERIENCER.has(reading.lemma) || (reflexive && EXPERIENCER.has(`${reading.lemma} się`)),
      sense: SENSES[text],
    };
  }
  return undefined;
}

/** An adjective in its dictionary form (masculine singular nominative): "zmęczony". */
function adjectiveHead(tokens: Token[], readings: (readonly Analysis[])[]): Head | undefined {
  for (const [at, token] of tokens.entries()) {
    const lower = token.core.toLowerCase();
    const reading = readings[at]?.find(
      (a) => a.tag.pos === 'adj' && a.lemma.toLowerCase() === lower && has(a.tag, 0, 'sg'),
    );
    if (reading)
      return { at, lemma: reading.lemma, perfective: false, experiencer: false, sense: undefined };
  }
  return undefined;
}

/**
 * A noun in the nominative. It may be the subject only when it names someone: role "person",
 * a masculine personal or animal noun ("tata", "kot"), a name, a noun of the lexicon's animate
 * list ("mama", "krowa", "dziecko" — ARASAAC's "mama" has the role "noun"). "mleko" + "pić"
 * must not say "mleko pije", so other nouns before a verb are taken for objects (PLAN §2.10).
 */
function nounReading(
  readings: readonly Analysis[],
  role: FitzgeraldRole | null,
  lexicon: GrammarLexicon,
  label: string,
): Pick<WordInfo, 'noun' | 'subject' | 'nominal'> | undefined {
  const nominative = readings.filter((a) => a.tag.pos === 'subst' && has(a.tag, 1, 'nom'));
  const reading = nominative.find((a) => has(a.tag, 0, 'sg')) ?? nominative[0];
  if (!reading) {
    if (role !== 'person' || readings.length > 0) return undefined;
    // Someone the lexicon does not know ("Burek", an own tile): 3rd person, the gender guessed.
    const guess: Agreement = { person: 3, plural: false, gender: /a$/i.test(label) ? 'f' : 'm1' };
    return { noun: true, subject: guess, nominal: guess };
  }
  const agreement = nounAgreement(reading.tag);
  const g = reading.tag.attrs[2] ?? [];
  const name = reading.lemma.charAt(0) !== reading.lemma.charAt(0).toLowerCase();
  const someone =
    role === 'person' ||
    g.includes('m1') ||
    g.includes('m2') ||
    g.includes('p1') ||
    name ||
    lexicon.animate(reading.lemma);
  return someone
    ? { noun: true, subject: agreement, nominal: agreement }
    : { noun: true, nominal: agreement };
}

// --- making forms -----------------------------------------------------------------------

function pick(forms: Form[], test: (tag: Tag) => boolean, sense?: string): string | undefined {
  const matching = forms.filter((f) => test(f.tag));
  return (
    (sense ? matching.find((f) => f.form.startsWith(sense)) : undefined)?.form ?? matching[0]?.form
  );
}

const VOWEL = /[aeiouyąęó]$/;

/** The verb agreeing with `a` in `tense`, or undefined when the lexicon lacks the form. */
function finiteForm(
  lexicon: GrammarLexicon,
  head: Head,
  a: Agreement,
  tense: Tense,
): string | undefined {
  const agreement: Agreement = head.experiencer ? { person: 3, plural: false, gender: 'n' } : a;
  const forms = lexicon.forms(head.lemma);
  if (tense === 'past') return pastForm(forms, agreement, head.sense);
  if (tense === 'future' && !head.perfective) {
    const be = pick(lexicon.forms('być'), (t) => t.pos === 'bedzie' && personTag(t, agreement));
    if (!be) return undefined;
    return head.lemma === 'być' ? be : `${be} ${head.lemma}`;
  }
  // Present; for a perfective verb these forms are its future ("zjem").
  return pick(forms, (t) => t.pos === 'fin' && personTag(t, agreement), head.sense);
}

/** praet + the person ending: "szedł" + "em", "szła" + "m", "szli" + "śmy". */
function pastForm(forms: Form[], a: Agreement, sense?: string): string | undefined {
  const praet = (t: Tag) =>
    t.pos === 'praet' && has(t, 0, a.plural ? 'pl' : 'sg') && genderTag(t, 1, a);
  // "niósł" alone, "niosłem" with the ending: the agl variant takes it.
  const base =
    a.person < 3 && !a.plural
      ? (pick(forms, (t) => praet(t) && has(t, 3, 'agl'), sense) ?? pick(forms, praet, sense))
      : pick(forms, (t) => praet(t) && !has(t, 3, 'agl'), sense);
  if (!base || a.person === 3) return base;
  if (a.plural) return base + (a.person === 1 ? 'śmy' : 'ście');
  if (VOWEL.test(base)) return base + (a.person === 1 ? 'm' : 'ś');
  return base + (a.person === 1 ? 'em' : 'eś');
}

/** Nominative adjective agreeing with `a` ("zmęczona", "zmęczeni"). */
function adjectiveForm(lexicon: GrammarLexicon, head: Head, a: Agreement): string | undefined {
  return pick(
    lexicon.forms(head.lemma),
    (t) =>
      t.pos === 'adj' &&
      has(t, 0, a.plural ? 'pl' : 'sg') &&
      has(t, 1, 'nom') &&
      genderTag(t, 2, a),
  );
}

/** The label with its head token replaced, in the token's case. */
function withHead(tokens: Token[], at: number, form: string): string {
  return tokens
    .map((t, i) => {
      if (i !== at) return t.raw;
      const start = t.raw.indexOf(t.core);
      return t.raw.slice(0, start) + matchCase(form, t.core) + t.raw.slice(start + t.core.length);
    })
    .join(' ');
}

// --- the sentence -------------------------------------------------------------------------

function speakerAgreement(speaker: SpeakerGender | null): Agreement {
  return { person: 1, plural: false, gender: speaker === 'f' ? 'f' : 'm1' };
}

/** Clauses as [start, end) ranges, and whether the words in them are left alone. */
function clauses(infos: WordInfo[]): { start: number; end: number; frozen: boolean }[] {
  const out: { start: number; end: number; frozen: boolean }[] = [];
  let start = 0;
  let frozen = false;
  let hasVerb = false;
  const close = (end: number) => {
    if (end > start) out.push({ start, end, frozen });
  };
  infos.forEach((info, i) => {
    if (info.separator) {
      close(i);
      start = i + 1;
      frozen = info.separator === 'subjunctive';
      hasVerb = false;
      return;
    }
    // "ja idę ty idziesz": a new pronoun after the clause's verb starts the next clause.
    if (hasVerb && info.subject && !info.noun) {
      close(i);
      start = i;
      frozen = false;
      hasVerb = false;
    }
    if (info.verb || info.finite) hasVerb = true;
    if (info.endsClause) {
      close(i + 1);
      start = i + 1;
      frozen = false;
      hasVerb = false;
    }
  });
  close(infos.length);
  return out;
}

/** The subject before `at` (and its coordinated partners: "ja i mama"), if any. */
function subjectBefore(infos: WordInfo[], start: number, at: number): Agreement | undefined {
  // A pronoun wins ("ja" + "pies" + "karmić" → "karmię"), else the first one naming someone
  // ("mama" + "tata" + "kochać" → "kocha"). Not after a preposition ("z mamą").
  let chosen = -1;
  for (let j = start; j < at; j++) {
    const info = infos[j];
    if (!info?.subject || (j > start && infos[j - 1]?.preposition)) continue;
    if (chosen < 0) chosen = j;
    if (!info.noun) {
      chosen = j;
      break;
    }
  }
  const subject = infos[chosen]?.subject;
  if (!subject) return undefined;
  // Partners on either side need not name someone themselves: "mama i tata", "ja i mama".
  const partners: Agreement[] = [];
  for (const step of [-2, 2]) {
    for (
      let k = chosen;
      k + step >= start && k + step < at && infos[k + step / 2]?.and;
      k += step
    ) {
      const partner = infos[k + step]?.subject ?? infos[k + step]?.nominal;
      if (!partner) break;
      partners.push(partner);
    }
  }
  return combine(subject, partners);
}

/**
 * The form of every word: its label when nothing changes. Pure and cheap (a sentence is a few
 * dozen words), so the whole sentence is redone on every change and a later word may change an
 * earlier one ("idę" + "wczoraj" → "szedłem wczoraj").
 */
export function inflectSentence(
  words: readonly GrammarWord[],
  lexicon: GrammarLexicon | null,
  options: InflectOptions,
): string[] {
  const out = words.map((w) => w.label);
  if (!lexicon || options.level === 'off' || words.length === 0) return out;
  const speaker = speakerAgreement(options.speaker);
  const infos = words.map((w) => readWord(w, lexicon, speaker));

  for (const { start, end, frozen } of clauses(infos)) {
    if (frozen) continue;
    const clause = infos.slice(start, end);
    const tense =
      clause
        .map((i) => i.tense)
        .filter(Boolean)
        .pop() ?? 'present';
    const first = clause.findIndex((i) => i.verb || i.finite);
    const slot = first < 0 ? -1 : start + first;
    const agreement = (slot >= 0 ? subjectBefore(infos, start, slot) : undefined) ?? speaker;

    // Verbs: the first agrees, the next stay infinitives ("chcę pić"); after "i" a verb repeats
    // the form of the one before ("jem i piję", but "chcę jeść i pić").
    // "jem zupę i piję" counts the last verb of the clause, whatever stands between.
    let lastVerbFinite = false;
    clause.forEach((info, n) => {
      const i = start + n;
      const head = info.verb;
      if (!head) {
        if (info.finite) lastVerbFinite = i === slot;
        return;
      }
      const coordinated = n > 0 && clause[n - 1]?.and === true;
      const finite: boolean = i === slot || (coordinated && lastVerbFinite);
      const form = finite ? finiteForm(lexicon, head, agreement, tense) : head.lemma;
      if (form) out[i] = withHead(info.tokens, head.at, form);
      lastVerbFinite = finite;
    });

    // Adjectives on their own say something of the subject: "ja" + "zmęczony" → "zmęczona".
    // Right before a noun they describe it, which the "full" level handles (G2).
    clause.forEach((info, n) => {
      const head = info.adjective;
      if (!head || clause[n + 1]?.noun) return;
      const i = start + n;
      const form = adjectiveForm(lexicon, head, subjectBefore(infos, start, i) ?? speaker);
      if (form) out[i] = withHead(info.tokens, head.at, form);
    });
  }
  return out;
}

// --- choosing a form by hand --------------------------------------------------------------

export interface FormChoice {
  /** The whole label with this form ("myję zęby"). */
  text: string;
  /** What the form answers or who says it ("ja", "kogo? czego?"). */
  hint: string;
}

export interface FormGroup {
  title: string;
  choices: FormChoice[];
}

const PERSONS: [string, Agreement][] = [
  ['ja', { person: 1, plural: false, gender: 'm1' }],
  ['ty', { person: 2, plural: false, gender: 'm1' }],
  ['on, ona', { person: 3, plural: false, gender: 'm1' }],
  ['my', { person: 1, plural: true, gender: 'm1' }],
  ['wy', { person: 2, plural: true, gender: 'm1' }],
  ['oni, one', { person: 3, plural: true, gender: 'm1' }],
];

const PAST_PERSONS: [string, Agreement][] = [
  ['ja (on)', { person: 1, plural: false, gender: 'm1' }],
  ['ja (ona)', { person: 1, plural: false, gender: 'f' }],
  ['ty (on)', { person: 2, plural: false, gender: 'm1' }],
  ['ty (ona)', { person: 2, plural: false, gender: 'f' }],
  ['on', { person: 3, plural: false, gender: 'm1' }],
  ['ona', { person: 3, plural: false, gender: 'f' }],
  ['ono', { person: 3, plural: false, gender: 'n' }],
  ['my', { person: 1, plural: true, gender: 'm1' }],
  ['my (same dziewczyny)', { person: 1, plural: true, gender: 'f' }],
  ['wy', { person: 2, plural: true, gender: 'm1' }],
  ['oni', { person: 3, plural: true, gender: 'm1' }],
  ['one', { person: 3, plural: true, gender: 'f' }],
];

const CASES: [string, string][] = [
  ['nom', 'kto? co?'],
  ['gen', 'kogo? czego?'],
  ['dat', 'komu? czemu?'],
  ['acc', 'kogo? co?'],
  ['inst', 'z kim? z czym?'],
  ['loc', 'o kim? o czym?'],
  ['voc', 'wołanie'],
];

/** One choice per form; a form answering several questions lists them all ("kto? co? / …"). */
function unique(choices: (FormChoice | undefined)[]): FormChoice[] {
  const byText = new Map<string, FormChoice>();
  for (const c of choices) {
    if (!c) continue;
    const seen = byText.get(c.text);
    if (!seen) byText.set(c.text, { ...c });
    else if (c.hint && !seen.hint.split(' / ').includes(c.hint)) seen.hint += ` / ${c.hint}`;
  }
  return [...byText.values()];
}

/**
 * Every form the user may pick for a word, grouped (PLAN §2.10 "Wybierz formę"). Empty when
 * the lexicon does not know the word.
 */
export function formChoices(word: GrammarWord, lexicon: GrammarLexicon | null): FormGroup[] {
  if (!lexicon) return [];
  const info = readWord({ ...word, fixed: false }, lexicon, speakerAgreement(null));
  const tokens = info.tokens;
  const readings = tokens.map((t) => (t.core ? lexicon.analyze(t.core) : []));
  const text = tokens
    .map((t) => t.core.toLowerCase())
    .filter(Boolean)
    .join(' ');
  const groups: FormGroup[] = [];
  const add = (title: string, choices: (FormChoice | undefined)[]) => {
    const list = unique(choices);
    if (list.length > 0) groups.push({ title, choices: list });
  };
  const things = word.role === 'noun' || word.role === 'person';
  const head = info.verb ?? (things ? undefined : verbHead(tokens, readings, text, true));
  if (head) {
    const verb = { ...head, experiencer: false };
    const as = (form: string | undefined, hint: string) =>
      form ? { text: withHead(tokens, head.at, form), hint } : undefined;
    if (!head.perfective)
      add(
        'Teraz',
        PERSONS.map(([hint, a]) => as(finiteForm(lexicon, verb, a, 'present'), hint)),
      );
    add(
      'Wcześniej',
      PAST_PERSONS.map(([hint, a]) => as(finiteForm(lexicon, verb, a, 'past'), hint)),
    );
    add(
      'Później',
      PERSONS.map(([hint, a]) => as(finiteForm(lexicon, verb, a, 'future'), hint)),
    );
    const forms = lexicon.forms(head.lemma);
    add(
      'Polecenie',
      (
        [
          ['ty', 'sg', 'sec'],
          ['my', 'pl', 'pri'],
          ['wy', 'pl', 'sec'],
        ] as const
      ).map(([hint, n, p]) =>
        as(
          pick(forms, (t) => t.pos === 'impt' && has(t, 0, n) && has(t, 1, p), head.sense),
          hint,
        ),
      ),
    );
    add('Bezokolicznik', [as(head.lemma, 'co robić?')]);
    return groups;
  }
  const adjective = info.adjective ?? adjectiveHead(tokens, readings);
  if (adjective) {
    const forms = lexicon.forms(adjective.lemma);
    const of = (title: string, n: string, gender: (t: Tag) => boolean) =>
      add(
        title,
        CASES.flatMap(([c, hint]) =>
          forms
            .filter(
              (f) => f.tag.pos === 'adj' && has(f.tag, 0, n) && has(f.tag, 1, c) && gender(f.tag),
            )
            .map((f) => ({ text: withHead(tokens, adjective.at, f.form), hint })),
        ),
      );
    of('jaki?', 'sg', (t) => has(t, 2, 'm1'));
    of('jaka?', 'sg', (t) => has(t, 2, 'f'));
    of('jakie?', 'sg', (t) => isNeuter(t, 2));
    of('jacy?', 'pl', (t) => has(t, 2, 'm1'));
    of('jakie? (wiele)', 'pl', (t) => has(t, 2, 'f'));
    return groups;
  }
  // A noun or pronoun: its cases, one and many.
  const at = 0;
  const reading = readings[at]?.find(
    (a) => (a.tag.pos === 'subst' || a.tag.pos.startsWith('ppron')) && has(a.tag, 1, 'nom'),
  );
  if (!reading || !tokens[at]) return groups;
  const forms = lexicon.forms(reading.lemma);
  const pos = reading.tag.pos;
  for (const [title, n] of [
    ['Jeden', 'sg'],
    ['Wiele', 'pl'],
  ] as const) {
    if (pos !== 'subst' && !has(reading.tag, 0, n)) continue;
    add(
      title,
      CASES.flatMap(([c, hint]) =>
        forms
          .filter((f) => f.tag.pos === pos && has(f.tag, 0, n) && has(f.tag, 1, c))
          .map((f) => ({ text: withHead(tokens, at, f.form), hint })),
      ),
    );
  }
  return groups;
}
