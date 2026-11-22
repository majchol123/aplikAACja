import json
import os
from pathlib import Path

import pytest
from conftest import CATALOG, CATEGORY_TREE, SHARED_VECTORS, FakeHttp

from relaacja_tools import arasaac
from relaacja_tools.symbolset import FLAG_AAC, FLAG_SEX, FLAG_VIOLENCE, load_index, read_manifest


def build(tmp_path: Path, http: FakeHttp, **kw: object) -> dict:
    return arasaac.build(
        tmp_path / "out", tmp_path / "cache", fetch=http, workers=2, min_items=0, **kw
    )


def set_dir(tmp_path: Path) -> Path:
    return tmp_path / "out" / arasaac.SET_DIR


def categories(tmp_path: Path) -> dict:
    name = read_manifest(set_dir(tmp_path))["categories"]
    return json.loads((set_dir(tmp_path) / name).read_text("utf-8"))


def test_index_contents(tmp_path: Path) -> None:
    manifest = build(tmp_path, FakeHttp())
    index = load_index(set_dir(tmp_path))
    by_id = {item["id"]: item for item in index["items"]}

    assert manifest["count"] == 11  # 9999 has no Polish keyword
    assert 9999 not in by_id
    assert [item["id"] for item in index["items"]] == sorted(by_id)
    assert by_id[9057]["k"] == ["ciasto", "ciasto z jabłkami"]  # deduplicated, order kept
    assert by_id[11403]["k"] == ["sok jabłkowy"]  # whitespace collapsed
    assert by_id[2462]["x"] == FLAG_AAC
    assert by_id[5000]["x"] == FLAG_SEX
    assert by_id[5001]["x"] == FLAG_VIOLENCE
    assert "x" not in by_id[2727]
    assert [by_id[i]["r"] for i in (2462, 6061, 7000, 7001, 7002)] == [
        "noun",
        "verb",
        "social",
        "person",
        "misc",
    ]
    assert index["attribution"].startswith("Autor symboli: Sergio Palao")
    for item in index["items"]:
        assert (set_dir(tmp_path) / item["f"]).read_bytes()[8:12] == b"WEBP"
    headers = (tmp_path / "out" / "_headers").read_text()
    assert "/sym/arasaac/p/*\n  Cache-Control: public, max-age=31536000, immutable" in headers


def test_build_is_deterministic(tmp_path: Path) -> None:
    first = build(tmp_path / "a", FakeHttp())
    second = build(tmp_path / "b", FakeHttp())
    assert first == second


def test_refresh_downloads_only_changed_pictograms(tmp_path: Path) -> None:
    build(tmp_path, FakeHttp())
    catalog = json.loads(json.dumps(CATALOG))
    catalog[0]["lastUpdated"] = "2026-11-01"  # 2462 changed
    catalog = [c for c in catalog if c["_id"] != 30000]  # 30000 withdrawn
    http = FakeHttp(catalog)
    manifest = build(tmp_path, http, catalog=catalog)

    images = [u for u in http.requests if u.endswith(".png")]
    assert images == ["https://static.arasaac.org/pictograms/2462/2462_500.png"]
    assert manifest["count"] == 10
    index = load_index(set_dir(tmp_path))
    assert 30000 not in {item["id"] for item in index["items"]}
    cached = {p.name for p in (tmp_path / "cache" / "webp").iterdir()}
    assert not any(name.startswith("30000.") for name in cached)
    assert len(list(set_dir(tmp_path).glob("index.*.json"))) == 1


def test_failed_image_keeps_previous_version(tmp_path: Path) -> None:
    build(tmp_path, FakeHttp())
    before = {i["id"]: i["f"] for i in load_index(set_dir(tmp_path))["items"]}
    catalog = json.loads(json.dumps(CATALOG))
    catalog[0]["lastUpdated"] = "2026-11-01"
    build(tmp_path, FakeHttp(catalog, broken={2462}), catalog=catalog)
    after = {i["id"]: i["f"] for i in load_index(set_dir(tmp_path))["items"]}
    assert after[2462] == before[2462]


def test_new_image_that_fails_is_left_out(tmp_path: Path) -> None:
    manifest = build(tmp_path, FakeHttp(broken={2727}))
    assert manifest["count"] == 10


def test_refuses_partial_mirror(tmp_path: Path) -> None:
    catalog = [
        {"_id": i, "lastUpdated": "x", "keywords": [{"keyword": f"s{i}", "type": 2}]}
        for i in range(1, 30)
    ]
    with pytest.raises(SystemExit, match="failed"):
        build(tmp_path, FakeHttp(catalog, broken=set(range(1, 25))), catalog=catalog)
    assert not (tmp_path / "out").exists()


def test_refuses_small_catalog(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="usable pictograms"):
        arasaac.build(tmp_path / "out", tmp_path / "cache", fetch=FakeHttp(), min_items=100)


def test_refuses_to_wipe_foreign_directory(tmp_path: Path) -> None:
    out = tmp_path / "out"
    out.mkdir()
    (out / "important.txt").write_text("keep")
    with pytest.raises(SystemExit, match="refusing"):
        build(tmp_path, FakeHttp())
    assert (out / "important.txt").exists()


def test_sample_index_matches_shared_vector(tmp_path: Path) -> None:
    """packages/shared validates this file with its Zod schema and search tests."""
    build(tmp_path, FakeHttp())
    index = load_index(set_dir(tmp_path))
    golden = SHARED_VECTORS / "sample-index.json"
    if os.environ.get("UPDATE_GOLDEN"):
        golden.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", "utf-8")
    assert json.loads(golden.read_text("utf-8")) == index
    assert read_manifest(set_dir(tmp_path))["index"].startswith("index.")
    tree = categories(tmp_path)
    golden = SHARED_VECTORS / "sample-categories.json"
    if os.environ.get("UPDATE_GOLDEN"):
        golden.write_text(json.dumps(tree, ensure_ascii=False, indent=2) + "\n", "utf-8")
    assert json.loads(golden.read_text("utf-8")) == tree


def test_http_get_refuses_other_schemes() -> None:
    with pytest.raises(ValueError, match="non-https"):
        arasaac.http_get("file:///etc/passwd")


def test_sexuality_filter_covers_categories_not_only_the_sex_field() -> None:
    def entry(_id: int, word: str, **extra: object) -> dict:
        return {"_id": _id, "keywords": [{"keyword": word, "type": 2}], **extra}

    flags = {
        p.id: p.flags
        for p in arasaac.parse_catalog(
            [
                entry(1, "penis", sex=True, categories=["reproductive system"]),
                entry(2, "pochwa", sex=False, categories=["reproductive system"]),
                entry(3, "antykoncepcja", categories=["contraceptive method", "medicine"]),
                entry(4, "płeć", categories=["gender identity"]),
                entry(5, "bić", violence=True, categories=["sexual crime", "verb"]),
                entry(6, "jabłko", categories=["fruit"]),
                entry(7, "chleb", categories=None),
            ]
        )
    }
    assert {i for i, f in flags.items() if f & FLAG_SEX} == {1, 2, 3}
    assert flags[5] == FLAG_VIOLENCE


def test_category_tree_keeps_order_and_drops_empty_folders(tmp_path: Path) -> None:
    build(tmp_path, FakeHttp())
    nodes = categories(tmp_path)["nodes"]
    by_name = {n["n"]: n for n in nodes}
    # Tree order, parents first; "Pusta" and its child have no pictograms.
    assert [n["n"] for n in nodes] == [
        "Odżywianie się",
        "Jedzenie",
        "Owoce",
        "Deser",
        "Napój",
        "Organizmy żywe",
        "Twarz",
        "Komunikacja",
        "Powitanie",
        "Czasownik",
        "Seksualność",
    ]
    assert [n["id"] for n in nodes] == list(range(1, 12))
    assert "p" not in by_name["Odżywianie się"]
    assert by_name["Owoce"]["p"] == by_name["Jedzenie"]["id"]
    assert by_name["Jedzenie"]["p"] == by_name["Odżywianie się"]["id"]

    items = {i["id"]: i for i in load_index(set_dir(tmp_path))["items"]}
    ids = {name: n["id"] for name, n in by_name.items()}
    assert items[11403]["g"] == sorted([ids["Owoce"], ids["Napój"]])
    assert items[9057]["g"] == [ids["Deser"]]  # repeated key listed once
    assert "g" not in items[7001]  # no categories
    assert "g" not in items[7002]  # only a key the tree does not know


def test_category_icons_prefer_core_vocabulary_and_skip_filtered_symbols(tmp_path: Path) -> None:
    build(tmp_path, FakeHttp())
    icons = {n["n"]: n["i"] for n in categories(tmp_path)["nodes"]}
    assert icons["Owoce"] == 2462  # aac among the folder's own symbols
    assert icons["Jedzenie"] == 2462  # inner folder: from its subfolders
    assert icons["Napój"] == 6061
    assert icons["Czasownik"] == 6061  # not 5001 "bić" (violence), though its id is lower
    assert icons["Seksualność"] == 5000  # only filtered symbols: the folder is hidden anyway


def test_category_icon_named_like_the_folder_wins() -> None:
    def picto(_id: int, word: str, flags: int = 0) -> arasaac.Pictogram:
        return arasaac.Pictogram(_id, (word,), "noun", flags, "", ("fruit",))

    members = [picto(1, "gruszka", FLAG_AAC), picto(2, "Owoce"), picto(3, "owoce", FLAG_AAC)]
    assert arasaac.pick_icon("Owoce", members, members) == 3


def test_category_tree_falls_back_to_the_previous_copy(tmp_path: Path) -> None:
    build(tmp_path, FakeHttp())
    before = read_manifest(set_dir(tmp_path))["categories"]
    for broken in (b"", b"<html>maintenance</html>", b'{"data": []}'):
        build(tmp_path, FakeHttp(categories=broken))
        assert read_manifest(set_dir(tmp_path))["categories"] == before


def test_refuses_mirror_without_any_category_tree(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="category tree unavailable"):
        build(tmp_path, FakeHttp(categories=b""))
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize(
    "payload",
    [
        {"data": {"a": {"text": "A", "children": {"a": {"text": "again"}}}}},  # repeated key
        {"data": {"a": {"text": "A", "children": ["b"]}}},  # children not an object
        {"data": {}},
        {"locale": "pl"},
    ],
)
def test_category_tree_shape_is_checked(payload: dict) -> None:
    with pytest.raises(ValueError, match="category tree"):
        arasaac.parse_category_tree(payload)


def test_category_tree_depth_is_limited() -> None:
    tree: dict = {"text": "leaf"}
    for level in range(arasaac.MAX_CATEGORY_DEPTH + 1):
        tree = {"text": f"n{level}", "children": {f"k{level}": tree}}
    with pytest.raises(ValueError, match="too deep"):
        arasaac.parse_category_tree({"data": {"root": tree}})
    assert len(CATEGORY_TREE["data"]) == 5
