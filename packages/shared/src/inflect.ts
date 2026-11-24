/**
 * Inflecting the sentence bar (PLAN §2.10, F8): words keep their tiles' labels, the sentence
 * is said and shown in agreeing forms. Without a subject the speaker is "ja": "iść" → "idę",
 * "ty" + "iść" → "idziesz". Conservative on purpose — a wrong form changes what the user says,
 * so whatever is unclear stays as on the tile and the user can pick a form by hand.
 */
import { matchCase, type Analysis, type Form, type GrammarLexicon, type Tag } from './grammar.ts';
import type { FitzgeraldRole } from './symbols.ts';

/**
 * "verbs" (G1): verbs agree with the subject. "full" (G2): nouns, adjectives, numerals and
 * pronouns take their cases too — after verbs, prepositions, "nie" and "być".
 */
export const GRAMMAR_LEVELS = ['off', 'verbs', 'full'] as const;
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
type Case = 'nom' | 'gen' | 'dat' | 'acc' | 'inst' | 'loc';
const isCase = (c: string | undefined): c is Case =>
  c === 'nom' || c === 'gen' || c === 'dat' || c === 'acc' || c === 'inst' || c === 'loc';

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

/** Prepositions with their usual case ("do domu", "w domu", "z mamą", "przez park"). */
const PREPOSITIONS: Record<string, Case> = {
  do: 'gen',
  od: 'gen',
  bez: 'gen',
  dla: 'gen',
  u: 'gen',
  obok: 'gen',
  koło: 'gen',
  około: 'gen',
  wokół: 'gen',
  dookoła: 'gen',
  podczas: 'gen',
  zamiast: 'gen',
  według: 'gen',
  oprócz: 'gen',
  wśród: 'gen',
  naprzeciwko: 'gen',
  spod: 'gen',
  zza: 'gen',
  znad: 'gen',
  w: 'loc',
  na: 'loc',
  o: 'loc',
  po: 'loc',
  przy: 'loc',
  z: 'inst',
  nad: 'inst',
  pod: 'inst',
  przed: 'inst',
  za: 'inst',
  między: 'inst',
  pomiędzy: 'inst',
  przez: 'acc',
  ku: 'dat',
  dzięki: 'dat',
  przeciw: 'dat',
  przeciwko: 'dat',
  wbrew: 'dat',
};
/** Spellings before a cluster ("ze szkoły", "we wtorek"): the preposition they are. */
const PREPOSITION_SPELLINGS: Record<string, string> = {
  ze: 'z',
  we: 'w',
  ode: 'od',
  pode: 'pod',
  nade: 'nad',
  przede: 'przed',
  beze: 'bez',
  przeze: 'przez',
};

/**
 * Going or putting somewhere: after these "w", "na", "pod", "za"… take the accusative ("idę na
 * plac", "kładę pod stół", "idę po mleko").
 */
const MOTION = new Set([
  'iść',
  'pójść',
  'jechać',
  'pojechać',
  'biec',
  'pobiec',
  'lecieć',
  'polecieć',
  'płynąć',
  'popłynąć',
  'wejść',
  'wchodzić',
  'wjechać',
  'wjeżdżać',
  'wyjść',
  'wychodzić',
  'przyjść',
  'przychodzić',
  'przyjechać',
  'przyjeżdżać',
  'wracać',
  'wrócić',
  'kłaść',
  'położyć',
  'stawiać',
  'postawić',
  'wkładać',
  'włożyć',
  'wsiadać',
  'wsiąść',
  'wskoczyć',
  'wskakiwać',
  'rzucać',
  'rzucić',
  'chować',
  'schować',
  'wieszać',
  'powiesić',
  'zanieść',
  'zanosić',
  'zabrać',
  'zabierać',
  'zaprowadzić',
  'uciec',
  'uciekać',
  'spaść',
  'spadać',
  'upaść',
  'nalać',
  'nalewać',
  'wylać',
  'wspinać',
]);
const MOTION_PREPOSITIONS = new Set(['w', 'na', 'pod', 'nad', 'za', 'przed', 'między', 'po']);
/** Going about: only "na" takes the accusative ("chodzę na basen", but "biegam w parku"). */
const MOTION_ABOUT = new Set(['chodzić', 'jeździć', 'biegać', 'latać', 'pływać']);
/** Coming or taking from: "z" + a thing is the genitive ("wracam ze szkoły", "piję z kubka"). */
const SOURCE = new Set([
  'wracać',
  'wrócić',
  'wyjść',
  'wychodzić',
  'wyjąć',
  'wyjmować',
  'spaść',
  'spadać',
  'upaść',
  'zejść',
  'schodzić',
  'zdjąć',
  'zdejmować',
  'wysiąść',
  'wysiadać',
  'wyjechać',
  'wyjeżdżać',
  'przyjść',
  'przychodzić',
  'przyjechać',
  'przyjeżdżać',
  'uciec',
  'uciekać',
  'zeskoczyć',
  'wylać',
  'wylewać',
  'wypaść',
  'wypadać',
]);
/** Eating or drinking from something: "piję z kubka", "jem z talerza" — without an object. */
const CONTAINERS = new Set(['pić', 'wypić', 'napić', 'jeść', 'zjeść']);
/** "mam na imię Ola": the name after it stays in the nominative. */
const NAMING = 'imię';
/** Words that point at a noun and agree with it: "mojego psa", "tę piłkę". */
const DETERMINERS = new Set(['mój', 'twój', 'swój', 'nasz', 'wasz', 'ten', 'tamten']);
/**
 * Nouns PoliMorf reads both as m2 and m3 whose accusative is the m3 one ("mam sen", "lubię
 * sport"); for most such nouns the m2 one is right ("zjem banana", "gram w tenisa").
 */
const INANIMATE = new Set(['sen', 'sport', 'strach', 'lek', 'dół', 'czerwiec', 'tysiąc', 'plus']);
/** The speaker as an object: "pomóc" + "ja" asks someone ("pomóż mi"). */
const SPEAKER_OBJECTS = new Set(['ja', 'my']);
/** "jestem lekarzem": the noun after it is in the instrumental; a thing may be its subject. */
const COPULA = 'być';

/** Written numbers: the numeral they agree like ("2" like "dwa", "25" like "pięć"). */
function numberModel(n: number): string {
  if (n === 1) return 'jeden';
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 12 && lastTwo <= 14) return 'pięć';
  if (last >= 2 && last <= 4) return 'dwa';
  return 'pięć';
}

/** The lemma of a personal pronoun's object forms ("ona" → "on": "ją", "jej", "nią"). */
const PRONOUN_LEMMAS: Record<string, string> = {
  ja: 'ja',
  ty: 'ty',
  on: 'on',
  ona: 'on',
  ono: 'on',
  my: 'my',
  wy: 'wy',
  oni: 'on',
  one: 'on',
};

/** Roles of words that are never inflected (greetings, questions, little words). */
const FIXED_ROLES = new Set<FitzgeraldRole>(['social', 'question', 'misc']);

/** A table's own entry: never a property of Object ("constructor", "toString"). */
const own = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

// --- government (G2) ------------------------------------------------------------------------

/** A slot of a verb's frame: its case, and whether only someone or only a thing fills it. */
interface Slot {
  kase: Case;
  who: 'someone' | 'thing' | null;
}

interface Frame {
  slots: Slot[];
  /** The case after a preposition with this verb ("czekać na mamę"). */
  after: Partial<Record<string, Case>>;
  /** A thing before the verb may be its subject ("deszcz pada"). */
  thing: boolean;
}

/** A frame of GrammarData.government (tools/grammar/government.toml): "dat+ acc o:loc". */
function parseFrame(text: string | undefined): Frame | undefined {
  if (text === undefined) return undefined;
  const frame: Frame = { slots: [], after: {}, thing: false };
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token === 'thing') {
      frame.thing = true;
    } else if (token.includes(':')) {
      const [preposition, kase] = token.split(':');
      if (preposition && isCase(kase)) frame.after[preposition] = kase;
    } else {
      const kase = token.replace(/[+-]$/, '');
      const who = token.endsWith('+') ? 'someone' : token.endsWith('-') ? 'thing' : null;
      if (isCase(kase)) frame.slots.push({ kase, who });
    }
  }
  return frame;
}

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
  /** An adjective written in another form than its lemma ("moja"): agrees only with a noun. */
  asWritten?: boolean;
}

/** A noun or pronoun whose form follows its case (G2). */
interface Nominal {
  /** Its token in the label. */
  at: number;
  lemma: string;
  pronoun: boolean;
  number: 'sg' | 'pl';
  /** NKJP gender of the noun's reading (m1, m2, m3, f, n1, n2, p1, p2, p3). */
  gender: string;
  /** Adjectives of the same label that describe it ("sok pomarańczowy"). */
  adjectives: { at: number; lemma: string }[];
  /** A pronoun's person, number and gender. */
  agreement?: Agreement;
  /** Already in its case ("mi", "cię"): fills the verb's slot of that case, unchanged. */
  asWritten?: Case[];
}

/** "dwa", "pięć", "5": the noun after it takes its number and maybe the genitive. */
interface Numeral {
  lemma: string;
  /** Digits are left as written; only the noun follows them. */
  written: boolean;
}

/** The verb that governs the clause's objects, inflected by the app or not. */
interface Governor {
  lemma: string;
  reflexive: boolean;
  /** "nie chcę": an accusative object turns genitive ("nie chcę wody"). */
  negated: boolean;
  /** "myć zęby": the label holds its object, so the frame's own slots are taken. */
  ownObject: boolean;
}

interface WordInfo {
  tokens: Token[];
  verb?: Head;
  adjective?: Head;
  /** G2: a noun or pronoun taking a case. */
  head?: Nominal;
  numeral?: Numeral;
  governor?: Governor;
  /** "nie" on its own, before a verb. */
  negation?: boolean;
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
  /** A preposition, as its base ("ze" → "z"). */
  preposition?: string;
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
  if (text === 'nie') info.negation = true;
  const preposition = basePreposition(text);
  if (preposition) info.preposition = preposition;
  const tense = tokens.map((t) => own(TENSE_WORDS, t.core.toLowerCase())).find(Boolean);
  if (tense) info.tense = tense;
  if (info.separator || info.and || info.preposition || tense) return info;

  const readings = tokens.map((t) => (t.core ? lexicon.analyze(t.core) : []));
  const pronoun = own(PRONOUNS, text);
  if (pronoun) {
    info.subject = pronoun === 'speaker' ? speaker : pronoun;
    const lemma = own(PRONOUN_LEMMAS, text);
    // "pan", "pani" take the cases of nouns ("lubię panią").
    const head = lemma ? pronounHead(lemma, info.subject) : nominalHead(tokens, readings)?.head;
    if (head) info.head = head;
    return info;
  }
  if (!word.fixed) {
    const numeral = numeralOf(word.label, text, readings);
    if (numeral) {
      info.numeral = numeral;
      return info;
    }
  }

  // "mój", "twój", "ten": whatever their role, they agree with the noun after them (G2).
  // Never a verb's form ("ma" is also an old "moja").
  const verbal = readings.some((r) =>
    r.some((a) => FINITE_POS.has(a.tag.pos) || a.tag.pos === 'inf'),
  );
  if (!word.fixed && tokens.length === 1 && text !== 'to' && word.role !== 'verb' && !verbal) {
    const determiner = adjectiveHead(tokens, readings, true);
    if (determiner && DETERMINERS.has(determiner.lemma)) {
      info.adjective = determiner;
      return info;
    }
  }

  const finiteReading = readings.some((r) => r.some((a) => FINITE_POS.has(a.tag.pos)));
  // "Ja chcę": the label brings its own subject, so it stays as it is.
  const labelSubject =
    tokens.length > 1
      ? tokens.map((t) => own(PRONOUNS, t.core.toLowerCase())).find(Boolean)
      : undefined;
  const ownSubject = labelSubject !== undefined;
  if (word.fixed || FORMULAS.has(text) || (word.role && FIXED_ROLES.has(word.role)) || ownSubject) {
    if (finiteReading) {
      info.finite = true;
      const verb = verbHead(tokens, readings, text, true);
      if (verb) info.governor = governorOf(tokens, verb);
    }
    if (labelSubject) info.subject = labelSubject === 'speaker' ? speaker : labelSubject;
    const noun = nounReading(readings, tokens, word.role, lexicon);
    if (noun && !ownSubject) Object.assign(info, noun);
    return info;
  }

  const role = word.role;
  const verbAllowed = role !== 'noun' && role !== 'person';
  if (verbAllowed) {
    const verb = verbHead(tokens, readings, text);
    if (verb) {
      info.verb = verb;
      info.governor = governorOf(tokens, verb);
      return info;
    }
    // Another finite form ("boli", "idzie", "chodź"): said as it is, and the clause's verb.
    if (finiteReading && role !== 'descriptor') {
      info.finite = true;
      const other = verbHead(tokens, readings, text, true);
      if (other) info.governor = governorOf(tokens, other);
      return info;
    }
  }
  if (role === null || role === 'descriptor') {
    const adjective =
      adjectiveHead(tokens, readings) ??
      (tokens.length === 1 ? adjectiveHead(tokens, readings, true) : undefined);
    if (adjective) {
      info.adjective = adjective;
      return info;
    }
  }
  if (finiteReading && role === 'descriptor') info.finite = true;
  const object = objectPronoun(tokens, readings, text);
  if (object) {
    info.head = object;
    return info;
  }
  const noun = nounReading(readings, tokens, role, lexicon);
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
function adjectiveHead(
  tokens: Token[],
  readings: (readonly Analysis[])[],
  anyForm = false,
): Head | undefined {
  for (const [at, token] of tokens.entries()) {
    const lower = token.core.toLowerCase();
    const reading = readings[at]?.find(
      (a) =>
        a.tag.pos === 'adj' &&
        has(a.tag, 0, 'sg') &&
        (a.lemma.toLowerCase() === lower || (anyForm && has(a.tag, 1, 'nom'))),
    );
    if (reading)
      return {
        at,
        lemma: reading.lemma,
        perfective: false,
        experiencer: false,
        sense: undefined,
        ...(reading.lemma.toLowerCase() === lower ? {} : { asWritten: true }),
      };
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
  readings: (readonly Analysis[])[],
  tokens: Token[],
  role: FitzgeraldRole | null,
  lexicon: GrammarLexicon,
): Pick<WordInfo, 'noun' | 'subject' | 'nominal' | 'head'> | undefined {
  const found = nominalHead(tokens, readings);
  if (!found) {
    if (role !== 'person' || readings.some((r) => r.length > 0)) return undefined;
    // Someone the lexicon does not know ("Burek", an own tile): 3rd person, the gender guessed.
    const label = tokens[0]?.core ?? '';
    const guess: Agreement = { person: 3, plural: false, gender: /a$/i.test(label) ? 'f' : 'm1' };
    return { noun: true, subject: guess, nominal: guess };
  }
  const { reading, head } = found;
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
    ? { noun: true, subject: agreement, nominal: agreement, head }
    : { noun: true, nominal: agreement, head };
}

const basePreposition = (text: string): string | undefined =>
  own(PREPOSITION_SPELLINGS, text) ?? (own(PREPOSITIONS, text) ? text : undefined);

/**
 * Of several readings of a nominative noun: the singular; m2 over m1 ("pies": "psy", not
 * "psowie") and over m3 ("zjem banana"), except for INANIMATE ones.
 */
function preferredReading(nominative: readonly Analysis[]): Analysis | undefined {
  const singular = nominative.filter((a) => has(a.tag, 0, 'sg'));
  const pool = singular.length > 0 ? singular : nominative;
  const first = pool[0];
  const gender = first && INANIMATE.has(first.lemma) ? 'm3' : 'm2';
  return pool.find((a) => a.lemma === first?.lemma && has(a.tag, 2, gender)) ?? first;
}

/**
 * The noun of a label in the nominative and the adjectives describing it ("sok pomarańczowy",
 * "starsza pani"), up to a preposition inside it ("kanapka z serem"). A token that may also be an
 * adjective ("mała") is the noun only when no other is.
 */
function nominalHead(
  tokens: Token[],
  readings: (readonly Analysis[])[],
): { reading: Analysis; head: Nominal } | undefined {
  const inner = tokens.findIndex((t, i) => i > 0 && basePreposition(t.core.toLowerCase()));
  const end = inner < 0 ? tokens.length : inner;
  let found: { at: number; reading: Analysis } | undefined;
  for (let at = 0; at < end; at++) {
    const all = readings[at] ?? [];
    const reading = preferredReading(
      all.filter((a) => a.tag.pos === 'subst' && has(a.tag, 1, 'nom')),
    );
    if (!reading) continue;
    found ??= { at, reading };
    if (!all.some((a) => a.tag.pos === 'adj' && has(a.tag, 1, 'nom'))) {
      found = { at, reading };
      break;
    }
  }
  if (!found) return undefined;
  const { at, reading } = found;
  const number = has(reading.tag, 0, 'pl') ? 'pl' : 'sg';
  const gender = reading.tag.attrs[2]?.[0] ?? 'm3';
  const adjectives: Nominal['adjectives'] = [];
  for (let i = 0; i < end; i++) {
    if (i === at) continue;
    const adjective = readings[i]?.find(
      (a) =>
        a.tag.pos === 'adj' &&
        has(a.tag, 0, number) &&
        has(a.tag, 1, 'nom') &&
        has(a.tag, 2, gender),
    );
    if (adjective) adjectives.push({ at: i, lemma: adjective.lemma });
  }
  return {
    reading,
    head: { at, lemma: reading.lemma, pronoun: false, number, gender, adjectives },
  };
}

function pronounHead(lemma: string, agreement: Agreement): Nominal {
  return {
    at: 0,
    lemma,
    pronoun: true,
    number: agreement.plural ? 'pl' : 'sg',
    gender: agreement.gender,
    adjectives: [],
    agreement,
  };
}

/** "mi", "cię", "go", "nam": a personal pronoun already in an object's case ("daj mi piłkę"). */
function objectPronoun(
  tokens: Token[],
  readings: (readonly Analysis[])[],
  text: string,
): Nominal | undefined {
  if (tokens.length !== 1 || text === 'nie') return undefined;
  const forms = (readings[0] ?? []).filter(
    (a) => (a.tag.pos === 'ppron12' || a.tag.pos === 'ppron3') && !has(a.tag, 1, 'nom'),
  );
  const first = forms[0];
  if (!first) return undefined;
  const cases = forms.flatMap((a) => (a.tag.attrs[1] ?? []).filter(isCase));
  return {
    at: 0,
    lemma: first.lemma,
    pronoun: true,
    number: has(first.tag, 0, 'pl') ? 'pl' : 'sg',
    gender: '',
    adjectives: [],
    asWritten: cases,
  };
}

/** A numeral word in its dictionary form, or a number written in digits. */
function numeralOf(
  label: string,
  text: string,
  readings: (readonly Analysis[])[],
): Numeral | undefined {
  if (/^\d+$/.test(label.trim()))
    return { lemma: numberModel(Number(label.trim())), written: true };
  if (readings.length !== 1) return undefined;
  const reading = readings[0]?.find((a) => a.tag.pos === 'num' && a.lemma.toLowerCase() === text);
  return reading ? { lemma: reading.lemma, written: false } : undefined;
}

function governorOf(tokens: Token[], head: Head): Governor {
  const words = tokens.map((t) => t.core.toLowerCase());
  return {
    lemma: head.lemma,
    reflexive: words.includes('się'),
    negated: words.slice(0, head.at).includes('nie'),
    ownObject: words.some((w, i) => i > head.at && w !== 'się' && w !== ''),
  };
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

/** "pomóż", "daj": the imperative for "ty". */
const imperative = (lexicon: GrammarLexicon, head: Head) =>
  pick(
    lexicon.forms(head.lemma),
    (t) => t.pos === 'impt' && has(t, 0, 'sg') && has(t, 1, 'sec'),
    head.sense,
  );

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
  return withTokens(tokens, new Map([[at, form]]));
}

/** The label with some tokens replaced, each in its token's case. */
function withTokens(tokens: Token[], changes: ReadonlyMap<number, string>): string {
  return tokens
    .map((t, i) => {
      const form = changes.get(i);
      if (form === undefined) return t.raw;
      const start = t.raw.indexOf(t.core);
      return t.raw.slice(0, start) + matchCase(form, t.core) + t.raw.slice(start + t.core.length);
    })
    .join(' ');
}

// --- cases (G2) -----------------------------------------------------------------------------

/** A noun or pronoun with what goes with it: "do dużego domu", "dwie piłki", "ciebie". */
interface Phrase {
  head: number;
  preposition?: number;
  numeral?: number;
  /** Adjective words describing it, before it and right after it ("piłka czerwona"). */
  adjectives: number[];
}

function phrasesIn(infos: WordInfo[], start: number, end: number): Phrase[] {
  const out: Phrase[] = [];
  let preposition: number | undefined;
  let numeral: number | undefined;
  let adjectives: number[] = [];
  const reset = () => {
    preposition = undefined;
    numeral = undefined;
    adjectives = [];
  };
  for (let i = start; i < end; i++) {
    const info = infos[i];
    if (info?.preposition) {
      reset();
      preposition = i;
    } else if (info?.numeral) {
      numeral = i;
    } else if (info?.adjective) {
      adjectives.push(i);
    } else if (info?.head) {
      const phrase: Phrase = { head: i, adjectives: info.head.pronoun ? [] : adjectives };
      if (preposition !== undefined) phrase.preposition = preposition;
      if (numeral !== undefined) phrase.numeral = numeral;
      // Adjectives right after it describe it too, unless a noun follows them.
      let k = i + 1;
      while (k < end && infos[k]?.adjective) k++;
      if (!info.head.pronoun && !infos[k]?.head) {
        for (let j = i + 1; j < k; j++) phrase.adjectives.push(j);
        i = k - 1;
      }
      out.push(phrase);
      reset();
    } else {
      reset();
    }
  }
  return out;
}

const frameOf = (lexicon: GrammarLexicon, g: Governor) =>
  parseFrame(lexicon.government(g.reflexive ? `${g.lemma} się` : g.lemma));

/** The case after a preposition: the verb's own ("czekam na mamę"), going somewhere, usual. */
function prepositionCase(
  preposition: string,
  governor: Governor | undefined,
  frame: Frame | undefined,
  { someone, after, object }: { someone: boolean; after: boolean; object: boolean },
): Case | undefined {
  const fixed = frame?.after[preposition];
  if (fixed) return fixed;
  // Going somewhere is said after the verb; "po obiedzie idę spać" is a time.
  const verb = after ? governor?.lemma : undefined;
  if (preposition === 'z') {
    // "z mamą", "z mlekiem", but "wracam ze szkoły", "piję z kubka" (not "piję herbatę z
    // cukrem": with an object the "z" goes with it).
    if (someone || verb === undefined) return 'inst';
    return SOURCE.has(verb) || (CONTAINERS.has(verb) && !object) ? 'gen' : 'inst';
  }
  if (
    verb !== undefined &&
    MOTION_PREPOSITIONS.has(preposition) &&
    (MOTION.has(verb) || (preposition === 'na' && MOTION_ABOUT.has(verb)))
  )
    return 'acc';
  return own(PREPOSITIONS, preposition);
}

/** The numeral's form for a noun of `gender` in `kase`; rec: the noun is then genitive. */
function numeralForm(
  lexicon: GrammarLexicon,
  numeral: Numeral,
  gender: string,
  kase: Case,
): { form: string | undefined; rec: boolean } | undefined {
  const all = lexicon.forms(numeral.lemma).filter((f) => f.tag.pos === 'num');
  // "dwu" is also the stem of "dwuletni" (num:comp): "dwóch lodów" before "dwu lodów".
  const stems = new Set(all.filter((f) => has(f.tag, 0, 'comp')).map((f) => f.form));
  const forms = all
    .filter((f) => has(f.tag, 1, kase) && has(f.tag, 2, gender))
    .sort((x, y) => Number(stems.has(x.form)) - Number(stems.has(y.form)));
  // "dwaj chłopcy" before "dwóch chłopców", "dwa koty"; "pięć kotów" has no other.
  const chosen = forms.find((f) => has(f.tag, 3, 'congr') && !has(f.tag, 3, 'rec')) ?? forms[0];
  if (!chosen) return undefined;
  return {
    form: numeral.written ? undefined : chosen.form,
    rec: has(chosen.tag, 3, 'rec') && !has(chosen.tag, 3, 'congr'),
  };
}

/** "dwa koty idą", "pięć kotów idzie": a numeral sets the noun's agreement. */
function numberAgreement(lexicon: GrammarLexicon, infos: WordInfo[], phrase: Phrase): void {
  const info = infos[phrase.head];
  const numeral = phrase.numeral === undefined ? undefined : infos[phrase.numeral]?.numeral;
  if (!info?.head || info.head.pronoun || !numeral || numeral.lemma === 'jeden') return;
  const n = numeralForm(lexicon, numeral, info.head.gender, 'nom');
  if (!n) return;
  const g = info.head.gender;
  const agreement: Agreement = n.rec
    ? { person: 3, plural: false, gender: 'n' }
    : { person: 3, plural: true, gender: g === 'm1' || g === 'p1' ? 'm1' : 'f' };
  info.nominal = agreement;
  if (info.subject) info.subject = agreement;
}

const adjectiveCase = (
  lexicon: GrammarLexicon,
  lemma: string,
  number: 'sg' | 'pl',
  kase: Case,
  gender: string,
) =>
  pick(
    lexicon.forms(lemma),
    (t) => t.pos === 'adj' && has(t, 0, number) && has(t, 1, kase) && has(t, 2, gender),
  );

/**
 * A pronoun in `kase`: "cię", "go", "mi" on their own, "ciebie", "niego" after a preposition
 * ("do niego", "z tobą"); never the old "mię".
 */
function pronounForm(
  lexicon: GrammarLexicon,
  head: Nominal,
  kase: Case,
  afterPreposition: boolean,
): string | undefined {
  const a = head.agreement;
  const candidates = lexicon.forms(head.lemma).filter((f) => {
    const t = f.tag;
    if (t.pos !== 'ppron12' && t.pos !== 'ppron3') return false;
    if (!has(t, 0, head.number) || !has(t, 1, kase)) return false;
    return t.pos === 'ppron12' || !a || has(t, 2, '_') || genderTag(t, 2, a);
  });
  const rank = (f: Form) => {
    const t = f.tag;
    if (f.form === 'mię') return 9;
    if (t.pos === 'ppron3') {
      if (afterPreposition) return has(t, 5, 'praep') ? 0 : has(t, 5, 'npraep') ? 2 : 1;
      return has(t, 5, 'praep') ? 3 : has(t, 4, 'nakc') ? 0 : 1;
    }
    if (afterPreposition) return has(t, 4, 'nakc') ? 2 : 0;
    return has(t, 4, 'akc') ? 1 : 0;
  };
  return [...candidates].sort((x, y) => rank(x) - rank(y))[0]?.form;
}

/** Every word of a phrase in `kase`; nothing changes when the lexicon lacks a form. */
function renderPhrase(
  lexicon: GrammarLexicon,
  infos: WordInfo[],
  out: string[],
  phrase: Phrase,
  kase: Case,
): void {
  const info = infos[phrase.head];
  const head = info?.head;
  if (!info || !head || head.asWritten) return;
  if (head.pronoun) {
    if (kase === 'nom') return;
    const form = pronounForm(lexicon, head, kase, phrase.preposition !== undefined);
    if (form) out[phrase.head] = withHead(info.tokens, head.at, form);
    return;
  }
  let nounCase = kase;
  let number = head.number;
  const numeralInfo = phrase.numeral === undefined ? undefined : infos[phrase.numeral];
  const numeral = numeralInfo?.numeral;
  let numeralText: string | undefined;
  if (numeral && numeral.lemma !== 'jeden') {
    const n = numeralForm(lexicon, numeral, head.gender, kase);
    if (!n) return;
    number = 'pl';
    if (n.rec && (kase === 'nom' || kase === 'acc')) nounCase = 'gen';
    numeralText = n.form;
  } else if (numeral && !numeral.written) {
    numeralText = adjectiveCase(lexicon, 'jeden', 'sg', kase, head.gender);
  }
  const noun = pick(
    lexicon.forms(head.lemma),
    (t) => t.pos === 'subst' && has(t, 0, number) && has(t, 1, nounCase) && has(t, 2, head.gender),
  );
  if (!noun) return;
  const changes = new Map([[head.at, noun]]);
  for (const a of head.adjectives) {
    const form = adjectiveCase(lexicon, a.lemma, number, nounCase, head.gender);
    if (form) changes.set(a.at, form);
  }
  out[phrase.head] = withTokens(info.tokens, changes);
  if (numeralText && numeralInfo && phrase.numeral !== undefined)
    out[phrase.numeral] = withHead(numeralInfo.tokens, 0, numeralText);
  for (const i of phrase.adjectives) {
    const adjective = infos[i]?.adjective;
    const tokens = infos[i]?.tokens;
    if (!adjective || !tokens) continue;
    const form = adjectiveCase(lexicon, adjective.lemma, number, nounCase, head.gender);
    if (form) out[i] = withHead(tokens, adjective.at, form);
  }
}

/** "z" + "szkoły" → "ze szkoły", "w" + "wtorek" → "we wtorek", "z" + "mną" → "ze mną". */
function vocalize(out: string[], i: number): void {
  const word = out[i];
  const next = out[i + 1]?.toLowerCase();
  if (word === undefined || next === undefined) return;
  const cluster = (first: RegExp) =>
    (first.test(next) && /^.[^aąeęioóuy]/.test(next)) || next.startsWith('mn');
  const lower = word.toLowerCase();
  if (lower === 'z' && cluster(/^[szśźż]/)) out[i] = matchCase('ze', word);
  if (lower === 'w' && cluster(/^[wf]/)) out[i] = matchCase('we', word);
}

interface ClauseContext {
  start: number;
  end: number;
  /** The clause's first verb, or -1. */
  slot: number;
  subject: Subject | undefined;
}

/**
 * The cases of a clause's phrases (level "full"): the subject in the nominative, after a
 * preposition its case, after "być" the instrumental ("jestem lekarzem"), the others fill the
 * verb's frame in their order ("daję mamie piłkę"); "nie" makes an accusative genitive.
 */
function assignCases(
  lexicon: GrammarLexicon,
  infos: WordInfo[],
  out: string[],
  phrases: Phrase[],
  { start, end, slot, subject }: ClauseContext,
): void {
  const subjectWords = new Set(subject?.words ?? []);
  // A noun belongs to the verb before it ("chcę pić sok": "pić"), else to the one after it
  // ("wody chcę"); each verb's slots are filled once.
  const verbs: number[] = [];
  for (let i = start; i < end; i++) if (infos[i]?.governor) verbs.push(i);
  const slots = new Map<number, Slot[]>();
  const slotsOf = (v: number, governor: Governor, frame: Frame | undefined) => {
    let left = slots.get(v);
    if (!left) {
      left = frame && !governor.ownObject ? [...frame.slots] : [];
      slots.set(v, left);
    }
    return left;
  };
  // "nie chcę pić wody": a "nie" anywhere before the verb counts.
  const negatedAt = (v: number) =>
    infos.slice(start, v + 1).some((i) => i.negation === true || i.governor?.negated === true);
  // "to jest piłka" keeps the nominative; "jestem lekarzem", "mama jest nauczycielką" not.
  const demonstrative = subject?.words.some((w) => infos[w]?.head?.lemma === 'to') ?? false;
  const bare = infos.slice(start, Math.max(slot, start)).every((i) => i.tense || i.negation);
  const predicative = !demonstrative && (subject !== undefined || bare);
  const filled = new Set<number>();
  let previous: Phrase | undefined;
  for (const phrase of phrases) {
    const info = infos[phrase.head];
    const head = info?.head;
    if (!info || !head) continue;
    const v = verbs.filter((i) => i < phrase.head).pop() ?? verbs.find((i) => i > phrase.head);
    const governor = v === undefined ? undefined : infos[v]?.governor;
    const frame = governor ? frameOf(lexicon, governor) : undefined;
    const someone = head.pronoun || info.subject !== undefined;
    const named =
      previous?.preposition !== undefined && infos[previous.head]?.head?.lemma === NAMING;
    let kase: Case = 'nom';
    if (phrase.preposition !== undefined) {
      const preposition = infos[phrase.preposition]?.preposition ?? '';
      const where = {
        someone,
        after: v !== undefined && v < phrase.head,
        object: filled.has(v ?? -1),
      };
      kase = prepositionCase(preposition, governor, frame, where) ?? 'nom';
    } else if (v === undefined || !governor || subjectWords.has(phrase.head) || named) {
      kase = 'nom';
    } else if (governor.lemma === COPULA && predicative && phrase.head > v) {
      kase = 'inst';
    } else {
      const left = slotsOf(v, governor, frame);
      const written = head.asWritten;
      const k = written
        ? left.findIndex((s) => written.includes(s.kase))
        : left.findIndex((s) => s.who === null || (s.who === 'someone') === someone);
      const chosen = left[k];
      if (chosen) {
        left.splice(k, 1);
        filled.add(v);
        kase = negatedAt(v) && chosen.kase === 'acc' ? 'gen' : chosen.kase;
      }
    }
    renderPhrase(lexicon, infos, out, phrase, kase);
    previous = phrase;
  }
  for (const phrase of phrases)
    if (phrase.preposition !== undefined) vocalize(out, phrase.preposition);
}

// --- the sentence -------------------------------------------------------------------------

function speakerAgreement(speaker: SpeakerGender | null): Agreement {
  return { person: 1, plural: false, gender: speaker === 'f' ? 'f' : 'm1' };
}

/** Clauses as [start, end) ranges, and whether the words in them are left alone. */
/** Whether a verb comes after word `i` before the clause ends. */
function verbFollows(infos: WordInfo[], i: number): boolean {
  for (let j = i + 1; j < infos.length; j++) {
    const info = infos[j];
    if (!info || info.separator) return false;
    if (info.verb || info.finite) return true;
    if (info.endsClause) return false;
  }
  return false;
}

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
    // "ja idę ty idziesz": a new pronoun after the clause's verb starts the next clause when a
    // verb follows; else it is an object ("lubię ty" → "lubię cię", level "full").
    if (hasVerb && info.subject && !info.noun && verbFollows(infos, i)) {
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
/** The subject of a clause's verb. */
interface Subject {
  agreement: Agreement;
  /** Its words, with the partners of "mama i tata". */
  words: number[];
}

function subjectBefore(
  infos: WordInfo[],
  start: number,
  at: number,
  things = false,
): Subject | undefined {
  // A pronoun wins ("ja" + "pies" + "karmić" → "karmię"), else the first one naming someone
  // ("mama" + "tata" + "kochać" → "kocha"), else — for verbs a thing may do, `things` — the
  // first noun ("deszcz pada"). Never after a preposition ("z mamą").
  const free = (j: number) => !(j > start && infos[j - 1]?.preposition);
  let chosen = -1;
  for (let j = start; j < at; j++) {
    const info = infos[j];
    if (!info?.subject || !free(j)) continue;
    if (chosen < 0) chosen = j;
    if (!info.noun) {
      chosen = j;
      break;
    }
  }
  if (chosen < 0 && things) {
    for (let j = start; j < at && chosen < 0; j++) if (infos[j]?.nominal && free(j)) chosen = j;
  }
  const first = infos[chosen];
  const subject = first?.subject ?? (things ? first?.nominal : undefined);
  if (!subject) return undefined;
  // Partners on either side need not name someone themselves: "mama i tata", "ja i mama".
  const words = [chosen];
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
      words.push(k + step);
    }
  }
  return { agreement: combine(subject, partners), words };
}

/** "tam jest mama": with nothing naming someone before "być", the noun after it. */
function subjectAfter(
  infos: WordInfo[],
  start: number,
  end: number,
  slot: number,
): Subject | undefined {
  if (infos.slice(start, slot).every((i) => i.tense || i.negation)) return undefined;
  for (let j = slot + 1; j < end; j++) {
    const info = infos[j];
    if (infos[j - 1]?.preposition) continue;
    const agreement = info?.subject ?? info?.nominal;
    if (agreement) return { agreement, words: [j] };
  }
  return undefined;
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
  const full = options.level === 'full';
  const speaker = speakerAgreement(options.speaker);
  const infos = words.map((w) => readWord(w, lexicon, speaker));

  for (const { start, end, frozen } of clauses(infos)) {
    if (frozen) continue;
    const clause = infos.slice(start, end);
    const phrases = full ? phrasesIn(infos, start, end) : [];
    for (const phrase of phrases) numberAgreement(lexicon, infos, phrase);
    const tense =
      clause
        .map((i) => i.tense)
        .filter(Boolean)
        .pop() ?? 'present';
    const first = clause.findIndex((i) => i.verb || i.finite);
    const slot = first < 0 ? -1 : start + first;
    const governor = infos[slot]?.governor;
    const frame = governor ? frameOf(lexicon, governor) : undefined;
    // A thing may be the subject of "być" and of verbs the table marks ("piłka jest duża").
    const copula = governor?.lemma === COPULA;
    const things = copula || Boolean(frame?.thing);
    const subject =
      slot < 0
        ? undefined
        : (subjectBefore(infos, start, slot, things) ??
          (copula ? subjectAfter(infos, start, end, slot) : undefined));
    const agreement = subject?.agreement ?? speaker;
    // "pomóc" + "ja" → "pomóż mi": with no subject named, the speaker asks someone.
    const request =
      full &&
      !subject &&
      tense === 'present' &&
      Boolean(infos[slot]?.verb) &&
      phrases.some(
        (p) =>
          p.head > slot &&
          p.preposition === undefined &&
          SPEAKER_OBJECTS.has(infos[p.head]?.head?.lemma ?? ''),
      );

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
      const asked = request && finite ? imperative(lexicon, head) : undefined;
      const form = asked ?? (finite ? finiteForm(lexicon, head, agreement, tense) : head.lemma);
      if (form) out[i] = withHead(info.tokens, head.at, form);
      lastVerbFinite = finite;
    });

    // Adjectives on their own say something of the subject: "ja" + "zmęczony" → "zmęczona".
    // Next to a noun they describe it, which the "full" level handles.
    const attributive = new Set(phrases.flatMap((p) => p.adjectives));
    clause.forEach((info, n) => {
      const head = info.adjective;
      const i = start + n;
      if (!head || head.asWritten || attributive.has(i) || clause[n + 1]?.noun) return;
      const about =
        slot >= 0 && i > slot ? agreement : (subjectBefore(infos, start, i)?.agreement ?? speaker);
      const form = adjectiveForm(lexicon, head, about);
      if (form) out[i] = withHead(info.tokens, head.at, form);
    });

    if (full) assignCases(lexicon, infos, out, phrases, { start, end, slot, subject });
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
