"""Grammar lexicon from PoliMorf (BSD-2) with NKJP tags, for inflecting sentences (PLAN §2.10, D15).

Output `grammar.<hash8>.json`, original spelling (unlike the normalized forms.<hash8>.json):

    {"v": 1,
     "tags": [tag, ...],                         # NKJP tags, sorted
     "paradigms": [[ending, [[tag, suffix], ...]], ...],
     "lemmas": [[lemma, paradigm], ...]}         # sorted

A paradigm is shared by every lemma that inflects the same way. `ending` is what follows the
stem (the longest common prefix of the lemma and all its forms); a rule gives a form as stem +
suffix. The table also reads backwards: a written word ending in a rule's suffix is that stem +
`ending` ("chcę" → chcieć, fin:sg:pri:imperf). When a tag has several forms, its rules are in
order of preference and the first is what the app says.

Scope ("core", PLAN §2.10): lemmas reachable from the set's vocabulary, every verb (own tiles
with any verb inflect without being defined), first names and the closed classes (pronouns,
numerals, "być"). The whole PoliMorf would be 8 MB of JSON and too slow on a tablet.
"""

from __future__ import annotations

import gzip
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


def load_variants(path: Path = VARIANTS_FILE) -> dict[str, re.Pattern[str]]:
    data = tomllib.loads(path.read_text("utf-8"))
    return {lemma: re.compile(pattern) for lemma, pattern in data.get("prefer", {}).items()}


@dataclass
class Grammar:
    data: dict[str, object]
    # (lemma, tag, forms) still ambiguous among vocabulary lemmas, for `--report`.
    ambiguous: list[tuple[str, str, list[str]]] = field(default_factory=list)


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
    sense of a homograph stays reachable: "paść się" is said with "pasę"), alphabetically."""
    ordered = sorted(forms)
    prefer = variants.get(lemma)
    if len(ordered) < 2 or prefer is None:
        return ordered
    return sorted(ordered, key=lambda f: prefer.fullmatch(f) is None)


def build_grammar(
    polimorf: Path, vocab: set[str], variants: dict[str, re.Pattern[str]] | None = None
) -> Grammar:
    core, reachable = select_lemmas(polimorf, vocab)
    return encode(polimorf, core, reachable, variants)


def encode(
    polimorf: Path,
    core: set[str],
    reachable: set[str],
    variants: dict[str, re.Pattern[str]] | None = None,
) -> Grammar:
    """The grammar file of `core`; ambiguities are reported for the `reachable` lemmas."""
    variants = load_variants() if variants is None else variants
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
    }
    return Grammar(data, ambiguous)


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
    set_dir: Path, polimorf: Path, variants: dict[str, re.Pattern[str]] | None = None
) -> tuple[dict[str, object], Grammar]:
    vocab = vocabulary_words(load_index(set_dir))
    grammar = build_grammar(polimorf, vocab, variants)
    data = canonical_json(grammar.data)
    name = f"grammar.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)
    manifest = read_manifest(set_dir) or {}
    manifest["grammar"] = name
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    log.info(
        "grammar: %d lemmas, %d paradigms, %d tags, %.2f MB → %s; %d ambiguous tags in the "
        "vocabulary (--report)",
        len(grammar.data["lemmas"]),  # type: ignore[arg-type]
        len(grammar.data["paradigms"]),  # type: ignore[arg-type]
        len(grammar.data["tags"]),  # type: ignore[arg-type]
        len(data) / 1e6,
        name,
        len(grammar.ambiguous),
    )
    return manifest, grammar


def fixture(
    polimorf: Path, words: set[str], variants: dict[str, re.Pattern[str]] | None = None
) -> Grammar:
    """A small grammar file with every lemma of `words` plus the pronouns and "być", from the
    real PoliMorf: the test vector of the TypeScript reader and the e2e mirror."""
    wanted = {w.lower() for w in words}
    always = {"ppron12", "ppron3", "siebie", "bedzie", "aglt"}
    lemmas = {
        e.lemma
        for e in read_entries(polimorf)
        if e.form.lower() in wanted or e.lemma.lower() in wanted or e.tag.split(":")[0] in always
    }
    return encode(polimorf, lemmas, lemmas, variants)
