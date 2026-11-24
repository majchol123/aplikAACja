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
  const { tags, paradigms, lemmas } = data;
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

export class GrammarLexicon {
  readonly tags: readonly Tag[];
  private readonly paradigms: GrammarData['paradigms'];
  private readonly byLemma = new Map<string, number>();
  /** Form ending → [paradigm, tag]; built on the first analysis of a word that is no lemma. */
  private bySuffix: Map<string, [number, number][]> | null = null;
  private readonly analyses = new Map<string, readonly Analysis[]>();

  constructor(data: GrammarData) {
    this.tags = data.tags.map(parseTag);
    this.paradigms = data.paradigms;
    for (const [lemma, paradigm] of data.lemmas) this.byLemma.set(lemma, paradigm);
  }

  get size(): number {
    return this.byLemma.size;
  }

  has(lemma: string): boolean {
    return this.byLemma.has(lemma);
  }

  /** Every form of `lemma`; the forms of one tag are in order of preference. */
  forms(lemma: string): Form[] {
    const p = this.byLemma.get(lemma);
    const paradigm = p === undefined ? undefined : this.paradigms[p];
    if (!paradigm) return [];
    const [ending, rules] = paradigm;
    const stem = lemma.slice(0, lemma.length - ending.length);
    return rules.flatMap(([t, suffix]) => {
      const tag = this.tags[t];
      return tag ? [{ form: stem + suffix, tag }] : [];
    });
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

  private analyzeExact(word: string): Analysis[] {
    const index = this.suffixIndex();
    const out: Analysis[] = [];
    for (let i = 0; i <= word.length; i++) {
      const rules = index.get(word.slice(i));
      if (!rules) continue;
      const stem = word.slice(0, i);
      for (const [p, t] of rules) {
        const lemma = stem + (this.paradigms[p]?.[0] ?? '');
        const tag = this.tags[t];
        if (tag && this.byLemma.get(lemma) === p) out.push({ lemma, tag });
      }
    }
    return out;
  }

  private suffixIndex(): Map<string, [number, number][]> {
    if (this.bySuffix) return this.bySuffix;
    const index = new Map<string, [number, number][]>();
    this.paradigms.forEach(([, rules], p) => {
      for (const [t, suffix] of rules) {
        const list = index.get(suffix);
        if (list) list.push([p, t]);
        else index.set(suffix, [[p, t]]);
      }
    });
    this.bySuffix = index;
    return index;
  }
}
