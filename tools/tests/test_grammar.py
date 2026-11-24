import json
import re
from pathlib import Path

import pytest
from conftest import FakeHttp

import build_grammar_fixture
from aplikaacja_tools import arasaac, grammar
from aplikaacja_tools.symbolset import read_manifest

# Real PoliMorf lines (tab-separated: form, lemma, tag, qualifier), trimmed.
SAMPLE = """\
iść\tiść\tinf:imperf\tpospolita
idę\tiść\tfin:sg:pri:imperf\tpospolita
idziesz\tiść\tfin:sg:sec:imperf\tpospolita
szedł\tiść\tpraet:sg:m1.m2.m3:imperf\tpospolita
szła\tiść\tpraet:sg:f:imperf\tpospolita
idący\tiść\tpact:sg:nom.voc:m1.m2.m3:imperf:aff\tpospolita
pić\tpić\tinf:imperf\tpospolita
piję\tpić\tfin:sg:pri:imperf\tpospolita
pijesz\tpić\tfin:sg:sec:imperf\tpospolita
bić\tbić\tinf:imperf\tpospolita
biję\tbić\tfin:sg:pri:imperf\tpospolita
bijesz\tbić\tfin:sg:sec:imperf\tpospolita
biec\tbiec\tinf:imperf\tpospolita
biegnąć\tbiec\tinf:imperf\tpospolita
biegnę\tbiec\tfin:sg:pri:imperf\tpospolita
boleć\tboleć\tinf:imperf\tpospolita
boleje\tboleć\tfin:sg:ter:imperf\tpospolita
boli\tboleć\tfin:sg:ter:imperf\tpospolita
mama\tmama\tsubst:sg:nom:f\tpospolita
mamy\tmama\tsubst:sg:gen:f\tpospolita
duży\tduży\tadj:sg:nom.voc:m1.m2.m3:pos\tpospolita
duża\tduży\tadj:sg:nom.voc:f:pos\tpospolita
większy\tduży\tadj:sg:nom.voc:m1.m2.m3:com\tpospolita
kot\tkot\tsubst:sg:nom:m2\tpospolita
kota\tkot\tsubst:sg:gen:m2\tpospolita
Zosia\tZosia\tsubst:sg:nom:f\timię
Zosi\tZosia\tsubst:sg:gen:f\timię
Kowalski\tKowalski\tsubst:sg:nom:m1\tnazwisko
ja\tja\tppron12:sg:nom:m1.m2.m3.f.n1.n2:pri\tpospolita
mnie\tja\tppron12:sg:gen:m1.m2.m3.f.n1.n2:pri:akc\tpospolita
"""


@pytest.fixture
def sample(tmp_path: Path) -> Path:
    path = tmp_path / "sample.tab"
    path.write_text(SAMPLE, "utf-8")
    return path


def lemmas(data: dict) -> list[str]:
    return [lemma for lemma, _ in data["lemmas"]]


def test_core_holds_vocabulary_verbs_names_and_pronouns(sample: Path) -> None:
    built = grammar.build_grammar(sample, {"mama", "duży"}, variants={})
    # mama and duży from the vocabulary; every verb; the first name; the pronoun. Not kot
    # (outside the vocabulary) and not the surname.
    assert lemmas(built.data) == sorted(
        ["Zosia", "biec", "boleć", "bić", "duży", "iść", "ja", "mama", "pić"]
    )


def test_round_trip_keeps_forms_and_drops_unused_classes(sample: Path) -> None:
    built = grammar.build_grammar(sample, set(), variants={})
    forms = grammar.decode(built.data)
    assert forms["iść"] == {
        ("iść", "inf:imperf"),
        ("idę", "fin:sg:pri:imperf"),
        ("idziesz", "fin:sg:sec:imperf"),
        ("szedł", "praet:sg:m1.m2.m3:imperf"),
        ("szła", "praet:sg:f:imperf"),
    }  # no participle
    assert ("biegnąć", "inf:imperf") not in forms["biec"]  # the infinitive is the lemma
    assert forms["Zosia"] == {("Zosia", "subst:sg:nom:f"), ("Zosi", "subst:sg:gen:f")}
    assert built.data["tags"] == sorted(built.data["tags"])


def test_comparative_and_superlative_are_left_out(sample: Path) -> None:
    built = grammar.build_grammar(sample, {"duży"}, variants={})
    assert grammar.decode(built.data)["duży"] == {
        ("duży", "adj:sg:nom.voc:m1.m2.m3:pos"),
        ("duża", "adj:sg:nom.voc:f:pos"),
    }


def test_lemmas_that_inflect_alike_share_a_paradigm(sample: Path) -> None:
    data = grammar.build_grammar(sample, set(), variants={}).data
    paradigm = dict((lemma, p) for lemma, p in data["lemmas"])
    assert paradigm["pić"] == paradigm["bić"]
    ending, rules = data["paradigms"][paradigm["pić"]]
    assert ending == "ć"
    assert {suffix for _, suffix in rules} == {"ć", "ję", "jesz"}


def test_variants_table_orders_forms_and_reports_the_rest(sample: Path) -> None:
    raw = grammar.build_grammar(sample, {"boleć"}, variants={})
    assert raw.ambiguous == [("boleć", "fin:sg:ter:imperf", ["boleje", "boli"])]

    built = grammar.build_grammar(sample, {"boleć"}, variants={"boleć": re.compile("bol(?!ej).*")})
    data = built.data
    ending, rules = data["paradigms"][dict((lemma, p) for lemma, p in data["lemmas"])["boleć"]]
    stem = "boleć"[: len("boleć") - len(ending)]
    said = [stem + suffix for t, suffix in rules if data["tags"][t] == "fin:sg:ter:imperf"]
    assert said == ["boli", "boleje"]  # the preferred first, the other sense stays reachable
    assert built.ambiguous == []


def test_variants_file_compiles() -> None:
    variants = grammar.load_variants()
    assert "boleć" in variants
    assert variants["boleć"].fullmatch("boli") and not variants["boleć"].fullmatch("boleje")


def test_write_grammar_updates_manifest_and_prunes(tmp_path: Path, sample: Path) -> None:
    arasaac.build(tmp_path / "out", tmp_path / "cache", fetch=FakeHttp(), workers=1, min_items=0)
    set_dir = tmp_path / "out" / arasaac.SET_DIR
    manifest, _ = grammar.write_grammar(set_dir, sample, variants={})
    assert read_manifest(set_dir) == manifest
    assert re.fullmatch(r"grammar\.[0-9a-f]{8}\.json", manifest["grammar"])
    data = json.loads((set_dir / manifest["grammar"]).read_text("utf-8"))
    assert data["v"] == grammar.GRAMMAR_VERSION
    assert "pić" in lemmas(data)  # in the sample catalogue's vocabulary and a verb

    # A rebuild with another result replaces the file; the index stays referenced.
    grammar.write_grammar(set_dir, sample, variants={"boleć": re.compile("boli")})
    assert len(list(set_dir.glob("grammar.*.json"))) == 1
    assert (set_dir / read_manifest(set_dir)["index"]).exists()
    assert "/sym/arasaac/grammar.*" in (tmp_path / "out" / "_headers").read_text("utf-8")


POLIMORF = Path(__file__).parents[1] / ".cache/polimorf" / "PoliMorf-0.6.7.tab.gz"


@pytest.mark.skipif(not POLIMORF.exists(), reason="real PoliMorf not cached")
def test_fixture_is_up_to_date() -> None:
    built = grammar.fixture(POLIMORF, build_grammar_fixture.fixture_words())
    assert build_grammar_fixture.OUT.read_text("utf-8") == build_grammar_fixture.render(
        built.data
    ), "run: uv run build_grammar_fixture.py"
