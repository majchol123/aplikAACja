from pathlib import Path

import pytest

from relaacja_tools.template import (
    SymbolIndex,
    TemplateError,
    build_template,
    parse_token,
    render_preview,
)

ITEMS = [
    {"id": 10, "f": "p/10.00000000.webp", "k": ["jabłko"], "r": "noun"},
    {"id": 11, "f": "p/11.00000000.webp", "k": ["jabłko", "owoc"], "r": "noun", "x": 1},
    {"id": 12, "f": "p/12.00000000.webp", "k": ["owoc", "jabłko"], "r": "noun", "x": 1},
    {"id": 20, "f": "p/20.00000000.webp", "k": ["chcieć"], "r": "verb", "x": 1},
    {"id": 30, "f": "p/30.00000000.webp", "k": ["<b>mama</b>"], "r": "noun"},
    {"id": 40, "f": "p/40.00000000.webp", "k": ["jedzenie"], "r": "noun"},
]


@pytest.fixture
def index() -> SymbolIndex:
    return SymbolIndex(ITEMS)


def test_tokens():
    assert parse_token("chcę|chcieć@verb").__dict__ == {
        "label": "chcę",
        "lookup": "chcieć",
        "id": None,
        "role": "verb",
    }
    assert parse_token("nie chcę#6156@negation").id == 6156
    assert parse_token("  boję   się ").label == "boję się"
    assert parse_token("-") is None
    for bad in ["", "a@colour", "a#x", "a|b|c"]:
        with pytest.raises(TemplateError):
            parse_token(bad)


def test_lookup_prefers_main_keyword_then_core_vocabulary(index):
    # 11 and 10 both have "jabłko" first; 11 is core (AAC); 12 has it only second.
    assert index.resolve(parse_token("jablko")).get("id") == 11
    assert index.resolve(parse_token("owoc")).get("id") == 12
    assert index.resolve(parse_token("x#10")).get("id") == 10
    with pytest.raises(TemplateError, match="add #id"):
        index.resolve(parse_token("gruszka"))
    with pytest.raises(TemplateError, match="no symbol #99"):
        index.resolve(parse_token("x#99"))


def test_layout_words_then_folders(index):
    spec = {
        "name": "Start",
        "rows": 2,
        "cols": 2,
        "words": ["chcę|chcieć", "-", "mama#30@person"],
        "folders": [{"tile": "Jedzenie", "rows": 1, "cols": 2, "words": ["jabłko"]}],
    }
    t = build_template(spec, index)
    tiles = t["board"]["tiles"]
    assert [(x["label"], x["row"], x["col"]) for x in tiles] == [
        ("chcę", 0, 0),
        ("mama", 1, 0),
        ("Jedzenie", 1, 1),
    ]
    assert tiles[0]["colorRole"] == "verb"
    assert tiles[1]["colorRole"] == "person"
    assert tiles[2]["kind"] == "folder"
    assert tiles[2]["board"] == {
        "rows": 1,
        "cols": 2,
        "tiles": [
            {
                "row": 0,
                "col": 0,
                "label": "jabłko",
                "symbol": {"set": "arasaac", "ref": "11"},
                "colorRole": "noun",
            }
        ],
    }


def test_rejects_overfull_grids(index):
    with pytest.raises(TemplateError, match="do not fit"):
        build_template({"rows": 1, "cols": 1, "words": ["jabłko", "owoc"]}, index)


def test_preview_is_self_contained_and_escaped(index, tmp_path: Path):
    (tmp_path / "p").mkdir()
    for item in ITEMS:
        (tmp_path / item["f"]).write_bytes(b"RIFF....WEBP")
    t = build_template({"rows": 1, "cols": 2, "words": ["<i>mama</i>#30"]}, index)
    page = render_preview(t, index, tmp_path, "ARASAAC <attribution>")
    assert "data:image/webp;base64," in page
    assert "<i>mama</i>" not in page and "&lt;i&gt;mama&lt;/i&gt;" in page
    assert "&lt;b&gt;mama&lt;/b&gt;" in page
    assert "ARASAAC &lt;attribution&gt;" in page
    assert 'class="cell empty"' in page
