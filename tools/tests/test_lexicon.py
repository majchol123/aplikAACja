import json
import os
from pathlib import Path

import pytest
from conftest import SHARED_VECTORS, FakeHttp

from aplikaacja_tools import arasaac, lexicon
from aplikaacja_tools.symbolset import read_manifest


def test_lexicon_covers_vocabulary_and_inflected_keywords(polimorf: Path) -> None:
    lemmas = lexicon.build_lexicon(polimorf, {"jablko", "pic", "jablkami", "sok", "nos"})
    assert lemmas["jablko"] == ["jablka", "jablkami"]
    assert lemmas["pic"] == ["pije", "pilem"]
    assert lemmas["nos"] == ["nosa"]
    assert "kot" not in lemmas  # outside the vocabulary
    assert "mama" not in lemmas


def test_lexicon_reaches_lemma_of_inflected_keyword_token(polimorf: Path) -> None:
    # "ciasto z jabłkami": the token "jablkami" pulls in all forms of "jabłko".
    assert lexicon.build_lexicon(polimorf, {"jablkami"}) == {"jablko": ["jablka", "jablkami"]}


def test_write_lexicon_updates_manifest(tmp_path: Path, polimorf: Path) -> None:
    arasaac.build(tmp_path / "out", tmp_path / "cache", fetch=FakeHttp(), workers=1, min_items=0)
    set_dir = tmp_path / "out" / arasaac.SET_DIR
    manifest = lexicon.write_lexicon(set_dir, polimorf)
    assert read_manifest(set_dir) == manifest
    forms = json.loads((set_dir / manifest["forms"]).read_text("utf-8"))
    assert forms["v"] == 1

    golden = SHARED_VECTORS / "sample-forms.json"
    if os.environ.get("UPDATE_GOLDEN"):
        golden.write_text(json.dumps(forms, ensure_ascii=False, indent=2) + "\n", "utf-8")
    assert json.loads(golden.read_text("utf-8")) == forms

    # Rebuilding the index keeps the lexicon reference; a second lexicon replaces the first.
    lexicon.write_lexicon(set_dir, polimorf)
    assert len(list(set_dir.glob("forms.*.json"))) == 1


def test_polimorf_checksum(tmp_path: Path) -> None:
    path = tmp_path / "x.gz"
    path.write_bytes(b"tampered")
    with pytest.raises(SystemExit, match="SHA-256"):
        lexicon.verify_sha256(path, lexicon.POLIMORF_SHA256)
