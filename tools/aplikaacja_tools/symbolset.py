"""Shared writer for symbol-set asset directories (ARASAAC mirror, extra set).

Layout of a set directory (served under /sym/<set>/):

    manifest.json            tiny, revalidated: points at the current index and lexicon
    index.<hash8>.json       search index (immutable)
    forms.<hash8>.json       inflection lexicon (immutable, optional)
    categories.<hash8>.json  browsing tree (immutable, optional): items list their node ids
    <p|x>/<id>.<hash8>.webp  images (immutable, content-addressed)
    g/<id>.<hash8>.webp      own category icons (immutable, optional)

The JSON shapes are validated on the client by packages/shared/src/symbols.ts.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

INDEX_VERSION = 1

ROLES = ("person", "noun", "verb", "descriptor", "social", "question", "negation", "misc")
FLAG_AAC = 1
FLAG_SEX = 2
FLAG_VIOLENCE = 4

MANIFEST = "manifest.json"
HASHED_JSON_RE = re.compile(r"^(index|forms|categories)\.[0-9a-f]{8}\.json$")
CATEGORY_ICON_RE = re.compile(r"^g/[0-9]{1,10}\.[0-9a-f]{8}\.webp$")
# Same pattern as CATEGORY_KEY in packages/shared/src/symbols.ts.
CATEGORY_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9 _-]{0,99}$")
MAX_ITEM_CATEGORIES = 20
MAX_CATEGORY_NAME = 100

# Pictograms are flat artwork: lossless WebP is artefact-free and about as small as lossy.
WEBP_OPTIONS = {"lossless": True, "method": 4, "quality": 80}
MAX_SOURCE_PIXELS = 4096 * 4096


def hash8(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


def canonical_json(obj: object) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def encode_webp(source: bytes, max_size: int) -> bytes:
    """Decode an untrusted PNG/JPEG/WebP, fit it in a max_size square, re-encode as WebP."""
    with Image.open(io.BytesIO(source)) as img:
        if img.format not in ("PNG", "JPEG", "WEBP"):
            raise ValueError(f"unsupported image format {img.format!r}")
        if img.width * img.height > MAX_SOURCE_PIXELS:
            raise ValueError(f"image too large: {img.width}x{img.height}")
        rgba = img.convert("RGBA")
    if max(rgba.size) > max_size:
        rgba.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    rgba.save(out, "WEBP", **WEBP_OPTIONS)
    return out.getvalue()


@dataclass
class Item:
    id: int
    file: str  # relative to the set directory, e.g. "p/2462.ab12cd34.webp"
    keywords: list[str]
    role: str
    flags: int = 0
    categories: tuple[int, ...] = ()  # ids of the browsing-tree nodes listing this symbol

    def to_json(self) -> dict[str, object]:
        if self.role not in ROLES:
            raise ValueError(f"unknown role {self.role!r} for item {self.id}")
        if not self.keywords:
            raise ValueError(f"item {self.id} has no keywords")
        out: dict[str, object] = {"id": self.id, "f": self.file, "k": self.keywords, "r": self.role}
        if self.flags:
            out["x"] = self.flags
        if self.categories:
            out["g"] = sorted(set(self.categories))[:MAX_ITEM_CATEGORIES]
        return out


@dataclass(frozen=True)
class Category:
    """A folder of the browsing tree; the file lists parents before their children."""

    id: int
    name: str
    parent: int | None = None
    icon: int | None = None  # id of a symbol of the same set shown on the folder
    file: str | None = None  # or an own icon image, e.g. "g/3.ab12cd34.webp"
    # Survives rebuilds (ids may not): what admins' folder pictures are keyed by.
    key: str | None = None

    def to_json(self) -> dict[str, object]:
        out: dict[str, object] = {"id": self.id, "n": self.name}
        if self.key is not None:
            out["k"] = self.key
        if self.parent is not None:
            out["p"] = self.parent
        if self.icon is not None:
            out["i"] = self.icon
        if self.file is not None:
            out["f"] = self.file
        return out


@dataclass
class SetMeta:
    set: str  # "arasaac" | "extra"
    name: str
    attribution: str | None = None
    extra: dict[str, object] = field(default_factory=dict)


def write_index(
    set_dir: Path,
    meta: SetMeta,
    items: Iterable[Item],
    categories: Sequence[Category] | None = None,
) -> dict[str, object]:
    """Write index.<hash>.json (+ categories.<hash>.json) and a manifest; keeps the lexicon."""
    ordered = sorted(items, key=lambda item: item.id)
    index: dict[str, object] = {"v": INDEX_VERSION, "set": meta.set, "name": meta.name}
    if meta.attribution:
        index["attribution"] = meta.attribution
    index.update(meta.extra)
    index["items"] = [item.to_json() for item in ordered]
    data = canonical_json(index)
    name = f"index.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)

    tree_name = None
    if categories is not None:
        tree = canonical_json(category_file(meta.set, categories, ordered))
        tree_name = f"categories.{hash8(tree)}.json"
        (set_dir / tree_name).write_bytes(tree)

    manifest = read_manifest(set_dir) or {}
    manifest = {
        "v": INDEX_VERSION,
        "set": meta.set,
        "name": meta.name,
        "index": name,
        "count": len(ordered),
        **({"forms": manifest["forms"]} if "forms" in manifest else {}),
        **({"categories": tree_name} if tree_name else {}),
    }
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    return manifest


def category_file(
    set_name: str, categories: Sequence[Category], items: Sequence[Item]
) -> dict[str, object]:
    """The browsing tree, checked so that the client can trust ids, parents and icons."""
    symbols = {item.id for item in items}
    seen: set[int] = set()
    keys: set[str] = set()
    for node in categories:
        if node.id < 0 or node.id in seen:
            raise ValueError(f"category id {node.id} is negative or repeated")
        if node.parent is not None and node.parent not in seen:
            raise ValueError(f"category {node.id} comes before its parent {node.parent}")
        if not node.name or len(node.name) > MAX_CATEGORY_NAME:
            raise ValueError(f"category {node.id} has an empty or too long name")
        if node.icon is not None and node.icon not in symbols:
            raise ValueError(f"category {node.id} icon {node.icon} is not in the index")
        if node.file is not None and not CATEGORY_ICON_RE.match(node.file):
            raise ValueError(f"category {node.id} icon file {node.file!r} has a bad name")
        if node.key is not None:
            if not CATEGORY_KEY_RE.match(node.key) or node.key in keys:
                raise ValueError(f"category {node.id} key {node.key!r} is malformed or repeated")
            keys.add(node.key)
        seen.add(node.id)
    for item in items:
        unknown = set(item.categories) - seen
        if unknown:
            raise ValueError(f"item {item.id} is in unknown categories {sorted(unknown)}")
    return {"v": INDEX_VERSION, "set": set_name, "nodes": [node.to_json() for node in categories]}


def read_manifest(set_dir: Path) -> dict[str, object] | None:
    path = set_dir / MANIFEST
    if not path.exists():
        return None
    return json.loads(path.read_text("utf-8"))


def write_manifest(set_dir: Path, manifest: dict[str, object]) -> None:
    (set_dir / MANIFEST).write_bytes(canonical_json(manifest))


def prune_hashed_json(set_dir: Path, manifest: dict[str, object]) -> None:
    """Remove superseded index/forms/categories files so only referenced ones get deployed."""
    keep = {manifest.get("index"), manifest.get("forms"), manifest.get("categories")}
    for path in set_dir.iterdir():
        if HASHED_JSON_RE.match(path.name) and path.name not in keep:
            path.unlink()


def load_index(set_dir: Path) -> dict[str, object]:
    manifest = read_manifest(set_dir)
    if not manifest:
        raise FileNotFoundError(f"{set_dir / MANIFEST} not found")
    return json.loads((set_dir / str(manifest["index"])).read_text("utf-8"))
