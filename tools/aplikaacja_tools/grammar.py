"""Grammar lexicon from PoliMorf (BSD-2) with NKJP tags, for inflecting sentences (PLAN §2.10, D15).

Output `grammar.<hash8>.json`, original spelling (unlike the normalized forms.<hash8>.json):

    {"v": 1,
     "tags": [tag, ...],                         # NKJP tags, sorted
     "paradigms": [[ending, [[tag, suffix], ...]], ...],
     "lemmas": [[lemma, paradigm], ...],         # sorted
     "animate": [lemma, ...],                    # sorted: nouns naming someone (below)
     "government": {verb: frame, ...}}           # what a verb's objects take (below)

A paradigm is shared by every lemma that inflects the same way. `ending` is what follows the
stem (the longest common prefix of the lemma and all its forms); a rule gives a form as stem +
suffix. The table also reads backwards: a written word ending in a rule's suffix is that stem +
`ending` ("chcę" → chcieć, fin:sg:pri:imperf). When a tag has several forms, its rules are in
order of preference and the first is what the app says.

Scope ("core", PLAN §2.10): lemmas reachable from the set's vocabulary and the templates' labels
("koleżanka" is no ARASAAC keyword), every verb (own tiles with any verb inflect without being
defined), first names and the closed classes (pronouns, numerals, "być"). The whole PoliMorf
would be 8 MB of JSON and too slow on a tablet.

`animate`: who can do something, i.e. be the subject of a sentence ("krowa idzie", not "krowa
idę"). PoliMorf tells it only of masculine nouns (m1, m2, p1), which the app reads from the tags;
for the others the list comes from the set's people and animal categories, PoliMorf's n1 nouns
("dziecko", "kurczę") and grammar/animate.toml. Older clients ignore the field.

`government`: the rekcja table of grammar/government.toml ("lubić": "acc", "dać": "dat+ acc"),
for the "Pełna" level (G2); only verbs of the core, so a typo fails the check, not the app.
"""

from __future__ import annotations

import gzip
import json
import logging
import re
import tomllib
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from .symbolset import (
    canonical_json,
    hash8,
    load_index,
    prune_hashed_json,
    read_manifest,
    write_manifest,
)

log = logging.getLogger(__name__)

GRAMMAR_VERSION = 1
VARIANTS_FILE = Path(__file__).parents[1] / "grammar" / "variants.toml"
ANIMATE_FILE = Path(__file__).parents[1] / "grammar" / "animate.toml"
GOVERNMENT_FILE = Path(__file__).parents[1] / "grammar" / "government.toml"
# A slot of a government frame: a case (+ someone only, - things only), "preposition:case", or
# "thing" (a thing may be the subject). Read by packages/shared/src/inflect.ts.
FRAME_TOKEN_RE = re.compile(
    r"(?:gen|dat|acc|inst)[+-]?|[a-ząćęłńóśźż]+:(?:gen|dat|acc|inst|loc)|thing"
)
# Tiles the app creates itself: their words are in the core whatever the set has ("koleżanka").
TEMPLATES = Path(__file__).parents[2] / "templates"

# Word classes the app inflects or reads (NKJP tagset). Participles and gerunds are left out.
CLASSES = frozenset(
    {"subst", "adj", "fin", "praet", "impt", "inf", "ppron12", "ppron3", "siebie", "num", "bedzie"}
    | {"aglt"}
)
# Always in the core, whatever the vocabulary: pronouns, numerals, "być" (bedzie, aglt).
CLOSED = frozenset({"ppron12", "ppron3", "siebie", "num", "bedzie", "aglt"})
# Proper names kept as people ("do Zosi"); surnames and organisations are not tile words.
NAME_QUALIFIER = "imię"
DROPPED_QUALIFIERS = frozenset({"nazwisko", "organizacja"})
# Classes whose first form the app says on its own (G1): ambiguities there are reported. The
# imperative is only offered in the form picker, where every variant is listed.
SPOKEN_CLASSES = frozenset({"fin", "praet", "bedzie"})

WORD_RE = re.compile(r"[^\W\d_]+")

# ARASAAC categories (keys of its tree) whose pictograms show someone who can do something:
# people, professions and animals, with their subcategories ...
ANIMATE_CATEGORIES = frozenset(
    {"person", "animal", "professional", "religious person", "health personnel"}
    | {"professional artist"}
)
# ... except these, about their bodies, food, homes and ways.
NOT_ANIMATE_CATEGORIES = frozenset(
    {"human body", "human reproduction", "animal anatomy", "animal nutrition", "animal housing"}
    | {"animal reproduction", "animal physiology", "animal behaviour", "animal-assisted therapy"}
)
# Genders of nouns the app already takes for someone (inflect.ts).
PERSONAL_GENDERS = frozenset({"m1", "m2", "p1"})


@dataclass(frozen=True)
class Entry:
    form: str
    lemma: str
    tag: str
    qualifier: str


def read_entries(path: Path) -> Iterator[Entry]:
    """Single-word entries of the kept classes; adjectives only in the positive degree."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            form, lemma, tag = parts[0], parts[1], parts[2]
            qualifier = parts[3] if len(parts) > 3 else ""
            if not form or not lemma or " " in form or " " in lemma:
                continue
            word_class = tag.split(":", 1)[0]
            if word_class not in CLASSES or qualifier in DROPPED_QUALIFIERS:
                continue
            if word_class == "adj" and not tag.endswith(":pos"):
                continue
            # The infinitive is the lemma; "biegnąć" next to "biec" is never said.
            if word_class == "inf" and form != lemma:
                continue
            yield Entry(form, lemma, tag, qualifier)


def vocabulary_words(index: dict) -> set[str]:
    """Lowercased words of the set's keywords, Polish letters kept."""
    return {w for item in index["items"] for kw in item["k"] for w in WORD_RE.findall(kw.lower())}


def template_labels(node: object) -> list[str]:
    """Every "label" of a template's JSON."""
    if isinstance(node, dict):
        own = [node["label"]] if isinstance(node.get("label"), str) else []
        return own + [label for value in node.values() for label in template_labels(value)]
    if isinstance(node, list):
        return [label for value in node for label in template_labels(value)]
    return []


def template_words(templates: Path = TEMPLATES) -> set[str]:
    """Lowercased words of the templates' labels."""
    return {
        w
        for path in sorted(templates.glob("*.json"))
        for label in template_labels(json.loads(path.read_text("utf-8")))
        for w in WORD_RE.findall(label.lower())
    }


def load_government(path: Path = GOVERNMENT_FILE) -> dict[str, str]:
    """The [government] table: verb ("bać się" with its "się") → frame, checked."""
    table = tomllib.loads(path.read_text("utf-8")).get("government", {})
    for verb, frame in table.items():
        tokens = frame.split() if isinstance(frame, str) else []
        if not tokens or not all(FRAME_TOKEN_RE.fullmatch(t) for t in tokens):
            raise ValueError(f"{path.name}: {verb!r} has a bad frame {frame!r}")
    return dict(table)


def load_variants(path: Path = VARIANTS_FILE) -> dict[str, re.Pattern[str]]:
    data = tomllib.loads(path.read_text("utf-8"))
    return {lemma: re.compile(pattern) for lemma, pattern in data.get("prefer", {}).items()}


def animate_words(
    index: dict, categories: dict, names: frozenset[str] | set[str] | None = None
) -> set[str]:
    """Lowercased one-word keywords of the set's people and animals: by ARASAAC category keys,
    or, for a set of its own (`names`), by the names of its folders."""
    nodes = {node["id"]: node for node in categories.get("nodes", [])}

    def keys(node_id: int) -> set[str]:
        out: set[str] = set()
        node = nodes.get(node_id)
        while node is not None:
            label = node.get("n") if names is not None else node.get("k")
            if label:
                out.add(label)
            node = nodes.get(node.get("p"))
        return out

    wanted = ANIMATE_CATEGORIES if names is None else frozenset(names)
    unwanted = NOT_ANIMATE_CATEGORIES if names is None else frozenset()
    animate = {node_id for node_id in nodes if (k := keys(node_id)) & wanted and not k & unwanted}
    return {
        kw.lower()
        for item in index["items"]
        if animate.intersection(item.get("g", ()))
        for kw in item["k"]
        if WORD_RE.fullmatch(kw)
    }


def load_animate(path: Path = ANIMATE_FILE) -> tuple[set[str], set[str]]:
    """(include, exclude) of the [animate] table: lemmas."""
    table = tomllib.loads(path.read_text("utf-8")).get("animate", {})
    return set(table.get("include", [])), set(table.get("exclude", []))


def animate_lemmas(
    polimorf: Path,
    words: set[str],
    core: set[str],
    table: tuple[set[str], set[str]] | None = None,
) -> dict[str, str]:
    """Nouns of `core` naming someone, beyond those the app reads from their m1/m2/p1 tags:
    lemma → why (the set's keyword, "n1" or the table), for `--report`."""
    include, exclude = load_animate() if table is None else table
    why: dict[str, str] = {}
    # Lemmas with a reading the app does not take for someone; a lemma with m1 or m3 readings
    # ("pilot") is listed, as the app may read it either way.
    other: set[str] = set()
    for e in read_entries(polimorf):
        # Capitalised lemmas are names ("Ryba", "Dom"): the app reads them so on its own.
        if e.lemma not in core or not e.tag.startswith("subst:") or not e.lemma[:1].islower():
            continue
        parts = e.tag.split(":")
        genders = set(parts[3].split(".")) if len(parts) > 3 else set()
        if not genders & PERSONAL_GENDERS:
            other.add(e.lemma)
        if "nom" in parts[2].split(".") and e.form.lower() in words:
            why.setdefault(e.lemma, e.form.lower())
        if "n1" in genders:
            why.setdefault(e.lemma, "n1")
    out = {lemma: reason for lemma, reason in why.items() if lemma in other}
    out.update((lemma, ANIMATE_FILE.name) for lemma in include & core)
    return {lemma: out[lemma] for lemma in sorted(out) if lemma not in exclude}


@dataclass
class Grammar:
    data: dict[str, object]
    # (lemma, tag, forms) still ambiguous among vocabulary lemmas, for `--report`.
    ambiguous: list[tuple[str, str, list[str]]] = field(default_factory=list)
    # The animate list with why each lemma is on it, for `--report`.
    animate: dict[str, str] = field(default_factory=dict)
    # Verbs of the government table that are no verb of the core (typos, missing lemmas).
    unknown_government: list[str] = field(default_factory=list)
    # Verbs of the vocabulary without a government entry, for `--report`.
    ungoverned: list[str] = field(default_factory=list)


def select_lemmas(polimorf: Path, vocab: set[str]) -> tuple[set[str], set[str]]:
    """(core lemmas, of which those reachable from the vocabulary)."""
    core: set[str] = set()
    reachable: set[str] = set()
    for e in read_entries(polimorf):
        word_class = e.tag.split(":", 1)[0]
        if e.form.lower() in vocab or e.lemma.lower() in vocab:
            reachable.add(e.lemma)
            core.add(e.lemma)
        elif word_class == "inf" or word_class in CLOSED or e.qualifier == NAME_QUALIFIER:
            core.add(e.lemma)
    return core, reachable


def ordered_forms(
    lemma: str, tag: str, forms: set[str], variants: dict[str, re.Pattern[str]]
) -> list[str]:
    """Forms of one tag, preferred first: those the variants table names, then the rest (another
    sense of a homograph stays reachable: "paść się" is said with "pasę"), alphabetically. An
    indeclinable loan keeps its lemma first ("kakao" before "kakaa")."""
    ordered = sorted(forms)
    prefer = variants.get(lemma)
    if len(ordered) < 2:
        return ordered
    if prefer is None:
        if tag.startswith("subst:") and lemma.endswith("o") and lemma in forms:
            return sorted(ordered, key=lambda f: f != lemma)
        return ordered
    return sorted(ordered, key=lambda f: prefer.fullmatch(f) is None)


def build_grammar(
    polimorf: Path,
    vocab: set[str],
    variants: dict[str, re.Pattern[str]] | None = None,
    animate: set[str] | None = None,
    animate_table: tuple[set[str], set[str]] | None = None,
) -> Grammar:
    """`animate`: the set's words for people and animals (animate_words)."""
    core, reachable = select_lemmas(polimorf, vocab)
    someone = animate_lemmas(polimorf, animate or set(), core, animate_table)
    return encode(polimorf, core, reachable, variants, someone)


def encode(
    polimorf: Path,
    core: set[str],
    reachable: set[str],
    variants: dict[str, re.Pattern[str]] | None = None,
    animate: dict[str, str] | None = None,
    government: dict[str, str] | None = None,
) -> Grammar:
    """The grammar file of `core`; ambiguities are reported for the `reachable` lemmas.
    `animate` (animate_lemmas) is a subset of `core`; `government` defaults to the table."""
    variants = load_variants() if variants is None else variants
    government = load_government() if government is None else government
    by_lemma: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for e in read_entries(polimorf):
        if e.lemma in core:
            by_lemma[e.lemma][e.tag].add(e.form)

    rules_of: dict[str, list[tuple[str, str]]] = {}
    ambiguous: list[tuple[str, str, list[str]]] = []
    for lemma in sorted(by_lemma):
        pairs: list[tuple[str, str]] = []
        for tag in sorted(by_lemma[lemma]):
            forms = ordered_forms(lemma, tag, by_lemma[lemma][tag], variants)
            if (
                len(forms) > 1
                and lemma in reachable
                and lemma not in variants
                and tag.split(":", 1)[0] in SPOKEN_CLASSES
            ):
                ambiguous.append((lemma, tag, forms))
            pairs.extend((tag, form) for form in forms)
        rules_of[lemma] = pairs

    tags = sorted({tag for pairs in rules_of.values() for tag, _ in pairs})
    tag_index = {tag: i for i, tag in enumerate(tags)}
    paradigms: dict[tuple[str, tuple[tuple[int, str], ...]], int] = {}
    lemmas: list[list[object]] = []
    for lemma, pairs in rules_of.items():
        stem = lemma
        for _, form in pairs:
            stem = common_prefix(stem, form)
        key = (
            lemma[len(stem) :],
            tuple((tag_index[tag], form[len(stem) :]) for tag, form in pairs),
        )
        lemmas.append([lemma, paradigms.setdefault(key, len(paradigms))])
    data: dict[str, object] = {
        "v": GRAMMAR_VERSION,
        "tags": tags,
        "paradigms": [[ending, [list(r) for r in rules]] for ending, rules in paradigms],
        "lemmas": lemmas,
        "animate": sorted(lemma for lemma in animate or {} if lemma in rules_of),
    }
    verbs = {lemma for lemma, pairs in rules_of.items() if any(t[:4] == "inf:" for t, _ in pairs)}
    known = {v: frame for v, frame in government.items() if v.removesuffix(" się") in verbs}
    data["government"] = dict(sorted(known.items()))
    governed = {verb.removesuffix(" się") for verb in known}
    return Grammar(
        data,
        ambiguous,
        dict(animate or {}),
        unknown_government=sorted(set(government) - set(known)),
        ungoverned=sorted(verbs & reachable - governed),
    )


def common_prefix(a: str, b: str) -> str:
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return a[:n]


def decode(data: dict) -> dict[str, set[tuple[str, str]]]:
    """lemma → {(form, tag)}: the inverse of the encoding (tests, and the TS reader's contract)."""
    tags, paradigms = data["tags"], data["paradigms"]
    out: dict[str, set[tuple[str, str]]] = {}
    for lemma, p in data["lemmas"]:
        ending, rules = paradigms[p]
        stem = lemma[: len(lemma) - len(ending)]
        out[lemma] = {(stem + suffix, tags[t]) for t, suffix in rules}
    return out


def write_grammar(
    set_dir: Path,
    polimorf: Path,
    variants: dict[str, re.Pattern[str]] | None = None,
    animate_table: tuple[set[str], set[str]] | None = None,
) -> tuple[dict[str, object], Grammar]:
    index = load_index(set_dir)
    categories_file = (read_manifest(set_dir) or {}).get("categories")
    categories = (
        json.loads((set_dir / str(categories_file)).read_text("utf-8")) if categories_file else {}
    )
    animate = animate_words(index, categories)
    vocab = vocabulary_words(index) | template_words()
    grammar = build_grammar(polimorf, vocab, variants, animate, animate_table)
    data = canonical_json(grammar.data)
    name = f"grammar.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)
    manifest = read_manifest(set_dir) or {}
    manifest["grammar"] = name
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    log.info(
        "grammar: %d lemmas (%d animate), %d paradigms, %d tags, %.2f MB → %s; %d ambiguous "
        "tags in the vocabulary (--report)",
        len(grammar.data["lemmas"]),  # type: ignore[arg-type]
        len(grammar.data["animate"]),  # type: ignore[arg-type]
        len(grammar.data["paradigms"]),  # type: ignore[arg-type]
        len(grammar.data["tags"]),  # type: ignore[arg-type]
        len(data) / 1e6,
        name,
        len(grammar.ambiguous),
    )
    if grammar.unknown_government:
        log.warning("government.toml: no verb of the core: %s", grammar.unknown_government)
    return manifest, grammar


# Classes of a gated set's own file: verbs, names and closed classes are in the mirror's.
SET_CLASSES = frozenset({"subst", "adj"})


def write_set_grammar(
    set_dir: Path,
    polimorf: Path,
    animate_folders: frozenset[str] | set[str] = frozenset(),
    variants: dict[str, re.Pattern[str]] | None = None,
) -> tuple[dict[str, object], Grammar]:
    """grammar.<hash8>.json of a set served behind its gate (the extra set, PLAN §2.10 G2): the
    nouns and adjectives of its vocabulary, joined in the app to the mirror's file. Built with
    the set and deployed with it, so its words never reach the public file; `animate_folders`
    names its folders of people and animals."""
    index = load_index(set_dir)
    manifest = read_manifest(set_dir) or {}
    categories_file = manifest.get("categories")
    categories = (
        json.loads((set_dir / str(categories_file)).read_text("utf-8")) if categories_file else {}
    )
    vocab = vocabulary_words(index)
    lemmas = {
        e.lemma
        for e in read_entries(polimorf)
        if e.tag.split(":", 1)[0] in SET_CLASSES
        and (e.form.lower() in vocab or e.lemma.lower() in vocab)
    }
    words = animate_words(index, categories, animate_folders)
    someone = animate_lemmas(polimorf, words, lemmas)
    grammar = encode(polimorf, lemmas, lemmas, variants, someone, government={})
    data = canonical_json(grammar.data)
    name = f"grammar.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)
    manifest["grammar"] = name
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    log.info(
        "set grammar: %d lemmas (%d animate), %.2f MB → %s",
        len(grammar.data["lemmas"]),  # type: ignore[arg-type]
        len(grammar.data["animate"]),  # type: ignore[arg-type]
        len(data) / 1e6,
        name,
    )
    return manifest, grammar


def fixture(
    polimorf: Path,
    words: set[str],
    variants: dict[str, re.Pattern[str]] | None = None,
    animate: set[str] | None = None,
    animate_table: tuple[set[str], set[str]] | None = None,
) -> Grammar:
    """A small grammar file with every lemma of `words` plus the pronouns and "być", from the
    real PoliMorf: the test vector of the TypeScript reader and the e2e mirror. `animate`
    stands in for the set's words for people and animals."""
    wanted = {w.lower() for w in words}
    always = {"ppron12", "ppron3", "siebie", "bedzie", "aglt"}
    lemmas = {
        e.lemma
        for e in read_entries(polimorf)
        if e.form.lower() in wanted or e.lemma.lower() in wanted or e.tag.split(":")[0] in always
    }
    someone = animate_lemmas(polimorf, {w.lower() for w in animate or ()}, lemmas, animate_table)
    return encode(polimorf, lemmas, lemmas, variants, someone)
