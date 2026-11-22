"""Inflection lexicon from PoliMorf (BSD-2), filtered to a symbol set's vocabulary (PLAN D10).

Output `forms.<hash8>.json`: {"v": 1, "lemmas": {lemma: [form, ...]}}, everything normalized
(see normalize.py). The client inverts it to form → lemmas, so "jablka" finds "jabłko".
"""

from __future__ import annotations

import gzip
import hashlib
import logging
from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path

from .normalize import normalize, tokens
from .symbolset import (
    INDEX_VERSION,
    canonical_json,
    hash8,
    load_index,
    prune_hashed_json,
    read_manifest,
    write_manifest,
)

log = logging.getLogger(__name__)

POLIMORF_FILE = "PoliMorf-0.6.7.tab.gz"
POLIMORF_URL = (
    "https://zil.ipipan.waw.pl/PoliMorf?action=AttachFile&do=get&target=PoliMorf-0.6.7.tab.gz"
)
POLIMORF_SHA256 = "e9b2633bf384b7a778bdb4d17dd4c8055b1d040da9f5113dae513718854216b2"


def verify_sha256(path: Path, expected: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise SystemExit(f"{path}: SHA-256 mismatch (expected {expected})")


def read_pairs(path: Path) -> Iterator[tuple[str, str]]:
    """(normalized form, normalized lemma) for single-word entries of a PoliMorf .tab(.gz)."""
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2:
                continue
            form, lemma = normalize(parts[0]), normalize(parts[1])
            if form and lemma and " " not in form and " " not in lemma:
                yield form, lemma


def vocabulary(index: dict) -> set[str]:
    return {tok for item in index["items"] for kw in item["k"] for tok in tokens(kw)}


def build_lexicon(polimorf: Path, vocab: set[str]) -> dict[str, list[str]]:
    """All forms of every lemma that occurs in `vocab`, directly or as one of its forms."""
    # Pass 1: lemmas reachable from the vocabulary ("jabłkami" in a keyword → "jabłko").
    lemmas: set[str] = set()
    for form, lemma in read_pairs(polimorf):
        if form in vocab or lemma in vocab:
            lemmas.add(lemma)
    # Pass 2: every form of those lemmas.
    forms: dict[str, set[str]] = defaultdict(set)
    for form, lemma in read_pairs(polimorf):
        if lemma in lemmas and form != lemma:
            forms[lemma].add(form)
    return {lemma: sorted(forms[lemma]) for lemma in sorted(forms)}


def write_lexicon(set_dir: Path, polimorf: Path) -> dict[str, object]:
    index = load_index(set_dir)
    vocab = vocabulary(index)
    lemmas = build_lexicon(polimorf, vocab)
    data = canonical_json({"v": INDEX_VERSION, "lemmas": lemmas})
    name = f"forms.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)
    manifest = read_manifest(set_dir) or {}
    manifest["forms"] = name
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    log.info(
        "lexicon: %d vocabulary tokens → %d lemmas, %d forms, %.2f MB → %s",
        len(vocab),
        len(lemmas),
        sum(len(v) for v in lemmas.values()),
        len(data) / 1e6,
        name,
    )
    return manifest
