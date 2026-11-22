import json
import os
from pathlib import Path

import pytest
from conftest import CATALOG, SHARED_VECTORS, FakeHttp

from relaacja_tools import arasaac
from relaacja_tools.symbolset import FLAG_AAC, FLAG_SEX, FLAG_VIOLENCE, load_index, read_manifest


def build(tmp_path: Path, http: FakeHttp, **kw: object) -> dict:
    return arasaac.build(
        tmp_path / "out", tmp_path / "cache", fetch=http, workers=2, min_items=0, **kw
    )


def set_dir(tmp_path: Path) -> Path:
    return tmp_path / "out" / arasaac.SET_DIR


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
    assert index["attribution"].startswith("Autor piktogramów: Sergio Palao")
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


def test_http_get_refuses_other_schemes() -> None:
    with pytest.raises(ValueError, match="non-https"):
        arasaac.http_get("file:///etc/passwd")
