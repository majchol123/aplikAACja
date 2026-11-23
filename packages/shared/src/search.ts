import { tokenize } from './normalize.ts';
import {
  FLAG_AAC,
  isFiltered,
  SET_BASE,
  type FitzgeraldRole,
  type Lexicon,
  type LibrarySet,
  type SymbolFilter,
  type SymbolIndex,
} from './symbols.ts';

export interface SymbolHit {
  set: LibrarySet;
  id: number;
  /** Same-origin image URL. */
  src: string;
  /** The keyword that matched (original spelling). */
  label: string;
  role: FitzgeraldRole;
  flags: number;
  score: number;
}

export interface SearchOptions extends SymbolFilter {
  /** Active sets, in the user's priority order (PLAN §2.2). */
  sets: readonly LibrarySet[];
  limit?: number;
}

interface StoredItem {
  /** Position across all loaded indexes: the final tie-break (index order). */
  order: number;
  set: LibrarySet;
  id: number;
  src: string;
  keywords: string[];
  role: FitzgeraldRole;
  flags: number;
}

/** A normalized word plus every lemma it can be a form of. */
interface Word {
  token: string;
  terms: Set<string>;
}

/** One keyword of one item; a symbol with three keywords has three entries. */
interface Entry {
  item: StoredItem;
  keyword: number;
  words: Word[];
}

interface QueryWord extends Word {
  /** Last word while still being typed: also matches words it starts. */
  prefix: boolean;
}

/** How a query word matched a keyword word, weakest first. */
const Match = { None: 0, Prefix: 1, Lemma: 2, Exact: 3 } as const;
type Match = (typeof Match)[keyof typeof Match];

const MATCH_SCORE: Record<Match, number> = { 0: 0, 1: 40, 2: 90, 3: 100 };
const MIN_PREFIX = 2;

/**
 * Client-side symbol search (PLAN §3.3): diacritic-insensitive, inflection-aware through the
 * PoliMorf lexicon ("jablka" → jabłko), with type-ahead on the last word.
 */
export class SymbolSearch {
  private readonly items: StoredItem[] = [];
  private readonly entries: Entry[] = [];
  private readonly postings = new Map<string, Entry[]>();
  private readonly lemmasOf = new Map<string, string[]>();
  private readonly sortedTerms: string[];

  constructor(indexes: readonly SymbolIndex[], lexicons: readonly Lexicon[] = []) {
    for (const lexicon of lexicons) {
      for (const [lemma, forms] of Object.entries(lexicon.lemmas)) {
        for (const form of forms) {
          const known = this.lemmasOf.get(form);
          if (!known) this.lemmasOf.set(form, [lemma]);
          else if (!known.includes(lemma)) known.push(lemma);
        }
      }
    }
    for (const index of indexes) {
      const base = SET_BASE[index.set];
      for (const raw of index.items) {
        const item: StoredItem = {
          order: this.items.length,
          set: index.set,
          id: raw.id,
          src: base + raw.f,
          keywords: raw.k,
          role: raw.r,
          flags: raw.x ?? 0,
        };
        this.items.push(item);
        raw.k.forEach((keyword, keywordNo) => this.addEntry(item, keywordNo, keyword));
      }
    }
    this.sortedTerms = [...this.postings.keys()].sort();
  }

  get size(): number {
    return this.items.length;
  }

  search(query: string, options: SearchOptions): SymbolHit[] {
    const tokens = tokenize(query);
    const stillTyping = !/\s$/.test(query);
    const words: QueryWord[] = tokens.map((token, i) => ({
      token,
      terms: this.expand(token),
      prefix: stillTyping && i === tokens.length - 1 && token.length >= MIN_PREFIX,
    }));

    // Entries matching each query word; the result is their intersection.
    const candidates = words
      .map((word) => {
        const found = new Set<Entry>();
        for (const term of word.terms) this.collect(term, found);
        if (word.prefix) for (const term of this.prefixTerms(word.token)) this.collect(term, found);
        return found;
      })
      .sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = candidates;
    if (!smallest) return [];

    const allowed = new Set(options.sets);
    const best = new Map<StoredItem, { score: number; keyword: number }>();
    for (const entry of smallest) {
      const { item } = entry;
      if (!allowed.has(item.set) || !rest.every((found) => found.has(entry))) continue;
      if (isFiltered(item.flags, options)) continue;

      const matches = words.map((word) => this.match(entry, word));
      if (matches.includes(Match.None)) continue;
      let score = matches.reduce<number>((sum, m) => sum + MATCH_SCORE[m], 0);
      const extraWords = entry.words.length - words.length;
      score += extraWords <= 0 ? 300 : -10 * extraWords; // whole keyword matched
      score -= 2 * entry.keyword; // the first keyword is the main name

      const previous = best.get(item);
      if (!previous || score > previous.score) best.set(item, { score, keyword: entry.keyword });
    }

    // Equal match quality: set priority, then AAC core vocabulary, then index order (PLAN §2.3).
    const rank = (item: StoredItem) =>
      options.sets.indexOf(item.set) * 2 + (item.flags & FLAG_AAC ? 0 : 1);
    return [...best.entries()]
      .sort(([a, x], [b, y]) => y.score - x.score || rank(a) - rank(b) || a.order - b.order)
      .slice(0, options.limit ?? 60)
      .map(([item, { score, keyword }]) => ({
        set: item.set,
        id: item.id,
        src: item.src,
        label: item.keywords[keyword] ?? item.keywords[0] ?? '',
        role: item.role,
        flags: item.flags,
        score,
      }));
  }

  private addEntry(item: StoredItem, keyword: number, text: string): void {
    const words = tokenize(text).map((token) => ({ token, terms: this.expand(token) }));
    if (words.length === 0) return;
    const entry: Entry = { item, keyword, words };
    this.entries.push(entry);
    const seen = new Set<string>();
    for (const word of words) {
      for (const term of word.terms) {
        if (seen.has(term)) continue;
        seen.add(term);
        const list = this.postings.get(term);
        if (list) list.push(entry);
        else this.postings.set(term, [entry]);
      }
    }
  }

  private expand(token: string): Set<string> {
    return new Set([token, ...(this.lemmasOf.get(token) ?? [])]);
  }

  private collect(term: string, into: Set<Entry>): void {
    for (const entry of this.postings.get(term) ?? []) into.add(entry);
  }

  private *prefixTerms(prefix: string): Generator<string> {
    let lo = 0;
    let hi = this.sortedTerms.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.sortedTerms[mid] ?? '') < prefix) lo = mid + 1;
      else hi = mid;
    }
    for (const term of this.sortedTerms.slice(lo)) {
      if (!term.startsWith(prefix)) return;
      if (term !== prefix) yield term;
    }
  }

  private match(entry: Entry, word: QueryWord): Match {
    let best: Match = Match.None;
    for (const own of entry.words) {
      if (own.token === word.token) return Match.Exact;
      if (best < Match.Lemma && [...word.terms].some((term) => own.terms.has(term))) {
        best = Match.Lemma;
      } else if (
        best < Match.Prefix &&
        word.prefix &&
        [...own.terms].some((term) => term.startsWith(word.token))
      ) {
        best = Match.Prefix;
      }
    }
    return best;
  }
}

/**
 * The same matching for arbitrary labels (tiles of the account, saved phrases): returns
 * the positions of the labels that match `query`, best first. Built once per label list.
 */
export function labelSearch(
  labels: readonly string[],
  lexicons: readonly Lexicon[],
): (query: string, limit?: number) => number[] {
  const index: SymbolIndex = {
    v: 1,
    set: 'arasaac',
    name: 'labels',
    items: labels.map((label, id) => ({ id, f: '', k: [label], r: 'misc' })),
  };
  const search = new SymbolSearch([index], lexicons);
  return (query, limit = 50) =>
    search
      .search(query, { sets: ['arasaac'], hideSexual: false, hideViolence: false, limit })
      .map((hit) => hit.id);
}
