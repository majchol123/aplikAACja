/**
 * Reader of grammar.<hash8>.json (tools/aplikaacja_tools/grammar.py, PLAN §2.10): PoliMorf forms
 * with NKJP tags, in paradigms shared by every lemma that inflects alike. It generates the forms
 * of a lemma and analyses a written word back into lemma + tag ("chcę" → chcieć,
 * fin:sg:pri:imperf).
 */

export const GRAMMAR_FILE_VERSION = 1;

export interface GrammarData {
  v: typeof GRAMMAR_FILE_VERSION;
  /** NKJP tags, sorted ("fin:sg:pri:imperf"). */
  tags: string[];
  /** [ending of the lemma after the stem, [[tag, ending of the form], …] preferred first]. */
  paradigms: [string, [number, string][]][];
  /** [lemma, paradigm], sorted. */
  lemmas: [string, number][];
  /**
   * Nouns naming someone who can do something ("krowa", "mama"), sorted; m1/m2/p1 nouns are
   * read from their tags. Missing in files built before it: no noun beyond those is someone.
   */
  animate?: string[];
  /**
   * What a verb's objects take ("lubić": "acc", "dać": "dat+ acc", "bać się": "gen"), from
   * tools/grammar/government.toml; read by inflect.ts (level "full"). Missing in older files.
   */
  government?: Record<string, string>;
}

/** A parsed NKJP tag: the class and its positional attributes, each with its alternatives. */
export interface Tag {
  text: string;
  /** Word class: fin, praet, subst, adj, ppron12, … */
  pos: string;
  /** Attributes after the class, in tagset order; "m1.m2.m3" → ['m1', 'm2', 'm3']. */
  attrs: readonly (readonly string[])[];
}

export interface Analysis {
  lemma: string;
  tag: Tag;
}

export interface Form {
  form: string;
  tag: Tag;
}

function fail(why: string): never {
  throw new Error(`grammar file: ${why}`);
}

/**
 * Checks the shape the builder writes. Hand-written instead of zod: 40 000 entries would cost a
 * noticeable pause on a tablet, and the file is our own, content-addressed asset.
 */
export function parseGrammarData(json: unknown): GrammarData {
  if (typeof json !== 'object' || json === null) fail('not an object');
  const data = json as Record<string, unknown>;
  if (data.v !== GRAMMAR_FILE_VERSION) fail(`version ${String(data.v)}`);
  const { tags, paradigms, lemmas, animate, government } = data;
  if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) fail('tags');
  if (!Array.isArray(paradigms)) fail('paradigms');
  for (const p of paradigms as unknown[]) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || !Array.isArray(p[1]))
      fail('paradigm');
    for (const r of p[1] as unknown[]) {
      if (
        !Array.isArray(r) ||
        r.length !== 2 ||
        !Number.isInteger(r[0]) ||
        (r[0] as number) < 0 ||
        (r[0] as number) >= tags.length ||
        typeof r[1] !== 'string'
      )
        fail('rule');
    }
  }
  if (!Array.isArray(lemmas)) fail('lemmas');
  for (const l of lemmas as unknown[]) {
    if (
      !Array.isArray(l) ||
      l.length !== 2 ||
      typeof l[0] !== 'string' ||
      !Number.isInteger(l[1]) ||
      (l[1] as number) < 0 ||
      (l[1] as number) >= paradigms.length
    )
      fail('lemma');
    const ending = (paradigms[l[1] as number] as [string, unknown])[0];
    if (!(l[0] as string).endsWith(ending)) fail(`lemma ${l[0] as string}`);
  }
  if (
    animate !== undefined &&
    (!Array.isArray(animate) || !animate.every((a) => typeof a === 'string'))
  )
    fail('animate');
  if (
    government !== undefined &&
    (typeof government !== 'object' ||
      government === null ||
      Array.isArray(government) ||
      !Object.values(government).every((f) => typeof f === 'string'))
  )
    fail('government');
  return data as unknown as GrammarData;
}

export function parseTag(text: string): Tag {
  const [pos = '', ...rest] = text.split(':');
  return { text, pos, attrs: rest.map((a) => a.split('.')) };
}

/** Same first letter case as `model`: "Iść" → "Idę", "IŚĆ" → "IDĘ". */
export function matchCase(form: string, model: string): string {
  if (model.length > 1 && model === model.toUpperCase() && model !== model.toLowerCase())
    return form.toUpperCase();
  const first = model.charAt(0);
  if (first !== first.toLowerCase()) return form.charAt(0).toUpperCase() + form.slice(1);
  return form;
}

/** What lexicons derived with `withOwnWords` share: the files and their indexes. */
interface LexiconCore {
  parts: { tags: readonly Tag[]; paradigms: GrammarData['paradigms'] }[];
  /** Lemma → [part, paradigm]; the first file that has a lemma wins. */
  byLemma: Map<string, [number, number]>;
  animates: Set<string>;
  frames: Map<string, string>;
  /** Form ending → [part, paradigm, tag]; built on the first analysis of a word no lemma. */
  bySuffix: Map<string, [number, number, number][]> | null;
}

export class GrammarLexicon {
  /** Tags of the first file (tests, the admin preview). */
  readonly tags: readonly Tag[];
  /** Shared by the lexicons derived from this one (`withOwnWords`). */
  private readonly core: LexiconCore;
  /** Own words of the user's tiles (G3): lemma → [part, paradigm] of the word they go like. */
  private readonly own = new Map<string, [number, number]>();
  private readonly analyses = new Map<string, readonly Analysis[]>();
  private readonly derived = new Map<string, GrammarLexicon>();

  /** The mirror's file, then those of other sets (the extra set's nouns, PLAN §2.10 G2). */
  constructor(data: GrammarData | GrammarLexicon, ...more: GrammarData[]) {
    if (data instanceof GrammarLexicon) {
      this.core = data.core;
      this.tags = data.tags;
      return;
    }
    const files = [data, ...more];
    const core: LexiconCore = {
      parts: files.map((d) => ({ tags: d.tags.map(parseTag), paradigms: d.paradigms })),
      byLemma: new Map(),
      animates: new Set(),
      frames: new Map(),
      bySuffix: null,
    };
    files.forEach((d, part) => {
      for (const [lemma, paradigm] of d.lemmas)
        if (!core.byLemma.has(lemma)) core.byLemma.set(lemma, [part, paradigm]);
      for (const lemma of d.animate ?? []) core.animates.add(lemma);
      for (const [verb, frame] of Object.entries(d.government ?? {}))
        if (!core.frames.has(verb)) core.frames.set(verb, frame);
    });
    this.core = core;
    this.tags = core.parts[0]?.tags ?? [];
  }

  /**
   * This lexicon with the user's own words (TileGrammar.like): "hulajnoga" inflects like
   * "noga", "Burek" like "Marek". A word must end like the other word's paradigm ("oga", "ek");
   * one that does not is left out (ownWordFits). Cached per set of words.
   */
  withOwnWords(words: Iterable<readonly [string, string]>): GrammarLexicon {
    const fitting = [...words].filter(([word, like]) => this.ownWordFits(word, like));
    if (fitting.length === 0) return this;
    const key = fitting
      .map(([w, l]) => `${w}\t${l}`)
      .sort()
      .join('\n');
    const cached = this.derived.get(key);
    if (cached) return cached;
    const lexicon = new GrammarLexicon(this);
    for (const [word, at] of this.own) lexicon.own.set(word, at);
    for (const [word, like] of fitting) {
      const at = this.lemmaAt(like);
      if (at) lexicon.own.set(word, at);
    }
    if (this.derived.size >= 32) this.derived.clear();
    this.derived.set(key, lexicon);
    return lexicon;
  }

  /** Whether `word` can inflect like the lemma `like` (it ends as that paradigm's lemmas do). */
  ownWordFits(word: string, like: string): boolean {
    const at = this.lemmaAt(like);
    const ending = at ? this.core.parts[at[0]]?.paradigms[at[1]]?.[0] : undefined;
    return ending !== undefined && word.length > ending.length && word.endsWith(ending);
  }

  get size(): number {
    return this.core.byLemma.size + this.own.size;
  }

  has(lemma: string): boolean {
    return this.lemmaAt(lemma) !== undefined;
  }

  /** Whether the noun `lemma` names someone beyond its tags (GrammarData.animate). */
  animate(lemma: string): boolean {
    return this.core.animates.has(lemma);
  }

  /** The government frame of a verb ("bać się" with its "się"), GrammarData.government. */
  government(verb: string): string | undefined {
    return this.core.frames.get(verb);
  }

  /** Every form of `lemma`; the forms of one tag are in order of preference. */
  forms(lemma: string): Form[] {
    const at = this.lemmaAt(lemma);
    const part = at && this.core.parts[at[0]];
    const paradigm = at && part ? part.paradigms[at[1]] : undefined;
    if (!part || !paradigm) return [];
    const [ending, rules] = paradigm;
    const stem = lemma.slice(0, lemma.length - ending.length);
    return rules.flatMap(([t, suffix]) => {
      const tag = part.tags[t];
      return tag ? [{ form: stem + suffix, tag }] : [];
    });
  }

  /**
   * Lemmas that `word` (unknown to the lexicon) might inflect like, best first: those sharing
   * the longest ending with it, one per paradigm, the paradigm most lemmas share first
   * ("hulajnoga" → "noga", "Burek" → "Marek"). `pos` keeps one class ("subst", "adj", "inf").
   */
  suggestLike(word: string, pos?: string, limit = 5): string[] {
    const lower = word.toLowerCase();
    const capital = word.charAt(0) !== lower.charAt(0);
    const best = new Map<string, { lemma: string; common: number; count: number }>();
    for (const [lemma, [part, p]] of this.core.byLemma) {
      if (lemma === word || (lemma.charAt(0) !== lemma.charAt(0).toLowerCase()) !== capital)
        continue;
      const paradigm = this.core.parts[part]?.paradigms[p];
      if (!paradigm || !word.endsWith(paradigm[0]) || word.length <= paradigm[0].length) continue;
      if (pos && !paradigm[1].some(([t]) => this.core.parts[part]?.tags[t]?.pos === pos)) continue;
      let common = 0;
      const l = lemma.toLowerCase();
      while (common < l.length && l[l.length - 1 - common] === lower[lower.length - 1 - common])
        common++;
      if (common < 2) continue;
      const key = `${part}:${p}`;
      const seen = best.get(key);
      if (!seen) best.set(key, { lemma, common, count: 1 });
      else {
        seen.count++;
        if (common > seen.common || (common === seen.common && lemma.length < seen.lemma.length)) {
          seen.lemma = lemma;
          seen.common = common;
        }
      }
    }
    return [...best.values()]
      .sort((a, b) => b.common - a.common || b.count - a.count || a.lemma.localeCompare(b.lemma))
      .slice(0, limit)
      .map((b) => b.lemma);
  }

  /**
   * Lemma + tag of every reading of a written word. Case-insensitive at the start of a word:
   * "Mama" is read as "mama", "zosia" as the name "Zosia".
   */
  analyze(word: string): readonly Analysis[] {
    const cached = this.analyses.get(word);
    if (cached) return cached;
    const lower = word.toLowerCase();
    const spellings = new Set([word, lower, lower.charAt(0).toUpperCase() + lower.slice(1)]);
    const out: Analysis[] = [];
    const seen = new Set<string>();
    for (const spelling of spellings) {
      for (const a of this.analyzeExact(spelling)) {
        const key = `${a.lemma}\t${a.tag.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
      }
    }
    this.analyses.set(word, out);
    return out;
  }

  private lemmaAt(lemma: string): [number, number] | undefined {
    return this.own.get(lemma) ?? this.core.byLemma.get(lemma);
  }

  private analyzeExact(word: string): Analysis[] {
    const index = this.suffixIndex();
    const out: Analysis[] = [];
    for (let i = 0; i <= word.length; i++) {
      const rules = index.get(word.slice(i));
      if (!rules) continue;
      const stem = word.slice(0, i);
      for (const [part, p, t] of rules) {
        const lemma = stem + (this.core.parts[part]?.paradigms[p]?.[0] ?? '');
        const tag = this.core.parts[part]?.tags[t];
        const at = this.lemmaAt(lemma);
        if (tag && at?.[0] === part && at[1] === p) out.push({ lemma, tag });
      }
    }
    return out;
  }

  private suffixIndex(): Map<string, [number, number, number][]> {
    if (this.core.bySuffix) return this.core.bySuffix;
    const index = new Map<string, [number, number, number][]>();
    this.core.parts.forEach(({ paradigms }, part) => {
      paradigms.forEach(([, rules], p) => {
        for (const [t, suffix] of rules) {
          const list = index.get(suffix);
          if (list) list.push([part, p, t]);
          else index.set(suffix, [[part, p, t]]);
        }
      });
    });
    this.core.bySuffix = index;
    return index;
  }
}
