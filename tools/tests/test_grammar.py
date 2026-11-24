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


# People and animals: nouns of any gender, PoliMorf's n1, an m1/m3 homograph, a name.
ANIMATE_SAMPLE = """\
krowa\tkrowa\tsubst:sg:nom:f\tpospolita
krowy\tkrowa\tsubst:sg:gen:f\tpospolita
krowy\tkrowa\tsubst:pl:nom:f\tpospolita
Krowa\tKrowa\tsubst:sg:nom:f\tgeograficzna
dziecko\tdziecko\tsubst:sg:nom:n1\tpospolita
oko\toko\tsubst:sg:nom:n1\tpospolita
kot\tkot\tsubst:sg:nom:m2\tpospolita
pilot\tpilot\tsubst:sg:nom:m1\tpospolita
pilot\tpilot\tsubst:sg:nom:m3\tpospolita
mleko\tmleko\tsubst:sg:nom:n2\tpospolita
lalka\tlalka\tsubst:sg:nom:f\tpospolita
"""


def test_animate_words_come_from_people_and_animal_categories() -> None:
    categories = {
        "nodes": [
            {"id": 1, "n": "Organizmy żywe", "k": "living being"},
            {"id": 2, "n": "Zwierzę", "k": "animal", "p": 1},
            {"id": 3, "n": "Ssak", "k": "mammal", "p": 2},
            {"id": 4, "n": "Anatomia zwierzęcia", "k": "animal anatomy", "p": 2},
            {"id": 5, "n": "Odżywianie się", "k": "feeding"},
        ]
    }
    index = {
        "items": [
            {"id": 1, "k": ["Krowa"], "g": [3]},  # in a subcategory
            {"id": 2, "k": ["ogon"], "g": [4]},  # about animals, not one
            {"id": 3, "k": ["mleko"], "g": [5]},
            {"id": 4, "k": ["kot", "mały kot"], "g": [5, 2]},  # one word only
            {"id": 5, "k": ["pies"]},  # in no category
        ]
    }
    assert grammar.animate_words(index, categories) == {"krowa", "kot"}


def test_animate_lemmas_add_categories_and_n1_minus_the_table(tmp_path: Path) -> None:
    path = tmp_path / "animate.tab"
    path.write_text(ANIMATE_SAMPLE, "utf-8")
    core = {"krowa", "Krowa", "dziecko", "oko", "kot", "pilot", "mleko", "lalka"}
    table = ({"lalka"}, {"oko", "mleko"})
    got = grammar.animate_lemmas(path, {"krowy", "kot", "pilot", "mleko"}, core, table)
    # krowa by a form of its keyword, dziecko as n1 (oko too, but the table drops it), pilot for
    # its m3 reading, lalka by the table. Not kot (m2: the app reads it from the tag) nor the
    # name Krowa.
    assert got == {"dziecko": "n1", "krowa": "krowy", "lalka": "animate.toml", "pilot": "pilot"}
    built = grammar.encode(path, core, core, {}, got)
    assert built.data["animate"] == ["dziecko", "krowa", "lalka", "pilot"]


def test_set_grammar_holds_nouns_and_adjectives_of_its_own(tmp_path: Path) -> None:
    polimorf = tmp_path / "animate.tab"
    polimorf.write_text(ANIMATE_SAMPLE + SAMPLE, "utf-8")
    set_dir = tmp_path / "extra"
    set_dir.mkdir()
    (set_dir / "index.00000000.json").write_text(
        json.dumps(
            {
                "items": [
                    {"id": 1, "k": ["krowa"], "g": [2]},
                    {"id": 2, "k": ["mleko"], "g": [1]},
                    {"id": 3, "k": ["iść"], "g": [1]},
                    {"id": 4, "k": ["duży"]},
                ]
            }
        ),
        "utf-8",
    )
    nodes = [{"id": 1, "n": "Napoje"}, {"id": 2, "n": "Zwierzęta"}]
    (set_dir / "categories.00000000.json").write_text(json.dumps({"nodes": nodes}), "utf-8")
    (set_dir / "manifest.json").write_text(
        json.dumps({"index": "index.00000000.json", "categories": "categories.00000000.json"}),
        "utf-8",
    )
    manifest, built = grammar.write_set_grammar(set_dir, polimorf, {"Zwierzęta"}, variants={})
    data = json.loads((set_dir / str(manifest["grammar"])).read_text("utf-8"))
    # Its nouns and adjectives only (the verb is in the mirror's file), the animals by folder.
    assert lemmas(data) == ["Krowa", "duży", "krowa", "mleko"]
    assert data["animate"] == ["krowa"] and data["government"] == {}
    assert built.data == data


def test_animate_file_compiles() -> None:
    include, exclude = grammar.load_animate()
    assert "koleżanka" in include and "dom" in exclude
    assert not include & exclude


def test_government_keeps_the_core_verbs_and_names_the_rest(sample: Path) -> None:
    table = {"pić": "acc", "bić się": "inst", "latać": "inst-"}
    built = grammar.encode(sample, {"pić", "bić", "mama"}, {"pić"}, {}, None, table)
    # "bić się" by its verb; "latać" is no verb of the core.
    assert built.data["government"] == {"bić się": "inst", "pić": "acc"}
    assert built.unknown_government == ["latać"]
    assert built.ungoverned == []  # "pić" (the only reachable verb) has an entry


def test_government_file_compiles(tmp_path: Path) -> None:
    table = grammar.load_government()
    assert table["chcieć"] == "gen" and table["dać"] == "dat+ acc"
    bad = tmp_path / "government.toml"
    bad.write_text('[government]\n"lubić" = "akk"\n', "utf-8")
    with pytest.raises(ValueError, match="lubić"):
        grammar.load_government(bad)


def test_write_grammar_updates_manifest_and_prunes(tmp_path: Path, sample: Path) -> None:
    arasaac.build(tmp_path / "out", tmp_path / "cache", fetch=FakeHttp(), workers=1, min_items=0)
    set_dir = tmp_path / "out" / arasaac.SET_DIR
    manifest, _ = grammar.write_grammar(set_dir, sample, variants={})
    assert read_manifest(set_dir) == manifest
    assert re.fullmatch(r"grammar\.[0-9a-f]{8}\.json", manifest["grammar"])
    data = json.loads((set_dir / manifest["grammar"]).read_text("utf-8"))
    assert data["v"] == grammar.GRAMMAR_VERSION
    assert "pić" in lemmas(data)  # in the sample catalogue's vocabulary and a verb
    assert data["animate"] == []  # the sample's "living being" holds only a face

    # A rebuild with another result replaces the file; the index stays referenced.
    grammar.write_grammar(set_dir, sample, variants={"boleć": re.compile("boli")})
    assert len(list(set_dir.glob("grammar.*.json"))) == 1
    assert (set_dir / read_manifest(set_dir)["index"]).exists()
    assert "/sym/arasaac/grammar.*" in (tmp_path / "out" / "_headers").read_text("utf-8")


POLIMORF = Path(__file__).parents[1] / ".cache/polimorf" / "PoliMorf-0.6.7.tab.gz"


@pytest.mark.skipif(not POLIMORF.exists(), reason="real PoliMorf not cached")
def test_fixture_is_up_to_date() -> None:
    built = build_grammar_fixture.build(POLIMORF)
    assert build_grammar_fixture.OUT.read_text("utf-8") == build_grammar_fixture.render(
        built.data
    ), "run: uv run build_grammar_fixture.py"


@pytest.mark.skipif(not POLIMORF.exists(), reason="real PoliMorf not cached")
def test_government_verbs_are_polimorf_verbs() -> None:
    verbs = {e.lemma for e in grammar.read_entries(POLIMORF) if e.tag.startswith("inf:")}
    unknown = [v for v in grammar.load_government() if v.removesuffix(" się") not in verbs]
    assert unknown == []
