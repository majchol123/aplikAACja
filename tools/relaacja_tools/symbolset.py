"""Shared writer for symbol-set asset directories (ARASAAC mirror, extra set).

Layout of a set directory (served under /sym/<set>/):

    manifest.json            tiny, revalidated: points at the current index and lexicon
    index.<hash8>.json       search index (immutable)
    forms.<hash8>.json       inflection lexicon (immutable, optional)
    <p|x>/<id>.<hash8>.webp  images (immutable, content-addressed)

The JSON shapes are validated on the client by packages/shared/src/symbols.ts.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

INDEX_VERSION = 1

ROLES = ("person", "noun", "verb", "descriptor", "social", "question", "negation", "misc")
FLAG_AAC = 1
FLAG_SEX = 2
FLAG_VIOLENCE = 4

MANIFEST = "manifest.json"
HASHED_JSON_RE = re.compile(r"^(index|forms)\.[0-9a-f]{8}\.json$")

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
    category: str | None = None

    def to_json(self) -> dict[str, object]:
        if self.role not in ROLES:
            raise ValueError(f"unknown role {self.role!r} for item {self.id}")
        if not self.keywords:
            raise ValueError(f"item {self.id} has no keywords")
        out: dict[str, object] = {"id": self.id, "f": self.file, "k": self.keywords, "r": self.role}
        if self.flags:
            out["x"] = self.flags
        if self.category:
            out["c"] = self.category
        return out


@dataclass
class SetMeta:
    set: str  # "arasaac" | "extra"
    name: str
    attribution: str | None = None
    extra: dict[str, object] = field(default_factory=dict)


def write_index(set_dir: Path, meta: SetMeta, items: Iterable[Item]) -> dict[str, object]:
    """Write index.<hash>.json and a manifest pointing at it; keeps an existing lexicon."""
    ordered = sorted(items, key=lambda item: item.id)
    index: dict[str, object] = {"v": INDEX_VERSION, "set": meta.set, "name": meta.name}
    if meta.attribution:
        index["attribution"] = meta.attribution
    index.update(meta.extra)
    index["items"] = [item.to_json() for item in ordered]
    data = canonical_json(index)
    name = f"index.{hash8(data)}.json"
    (set_dir / name).write_bytes(data)

    manifest = read_manifest(set_dir) or {}
    manifest = {
        "v": INDEX_VERSION,
        "set": meta.set,
        "name": meta.name,
        "index": name,
        "count": len(ordered),
        **({"forms": manifest["forms"]} if "forms" in manifest else {}),
    }
    write_manifest(set_dir, manifest)
    prune_hashed_json(set_dir, manifest)
    return manifest


def read_manifest(set_dir: Path) -> dict[str, object] | None:
    path = set_dir / MANIFEST
    if not path.exists():
        return None
    return json.loads(path.read_text("utf-8"))


def write_manifest(set_dir: Path, manifest: dict[str, object]) -> None:
    (set_dir / MANIFEST).write_bytes(canonical_json(manifest))


def prune_hashed_json(set_dir: Path, manifest: dict[str, object]) -> None:
    """Remove superseded index/forms files so only the referenced ones get deployed."""
    keep = {manifest.get("index"), manifest.get("forms")}
    for path in set_dir.iterdir():
        if HASHED_JSON_RE.match(path.name) and path.name not in keep:
            path.unlink()


def load_index(set_dir: Path) -> dict[str, object]:
    manifest = read_manifest(set_dir)
    if not manifest:
        raise FileNotFoundError(f"{set_dir / MANIFEST} not found")
    return json.loads((set_dir / str(manifest["index"])).read_text("utf-8"))
