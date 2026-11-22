"""ARASAAC mirror: Polish catalogue → WebP images + search index (PLAN §3.3, D4).

Incremental: the cache directory keeps every converted image together with the catalogue
`lastUpdated` it was built from, so a refresh downloads only new or changed pictograms.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from .symbolset import (
    FLAG_AAC,
    FLAG_SEX,
    FLAG_VIOLENCE,
    Item,
    SetMeta,
    encode_webp,
    hash8,
    write_index,
)

log = logging.getLogger(__name__)

CATALOG_URL = "https://api.arasaac.org/v1/pictograms/all/pl"
IMAGE_URL = "https://static.arasaac.org/pictograms/{id}/{id}_500.png"
USER_AGENT = "symbol-mirror/1.0"
IMAGE_SIZE = 500
SET_DIR = Path("sym") / "arasaac"
MARKER = ".relaacja-symbols"

ATTRIBUTION = (
    "Autor piktogramów: Sergio Palao. Pochodzenie: ARASAAC (https://arasaac.org). "
    "Licencja: CC (BY-NC-SA). Właściciel: Rząd Aragonii (Hiszpania)."
)

# ARASAAC keyword.type → Fitzgerald Key role (PLAN §3.3).
ROLE_BY_TYPE = {1: "person", 2: "noun", 3: "verb", 4: "descriptor", 5: "social", 6: "misc"}

HEADERS_FILE = """\
/sym/arasaac/*
  X-Content-Type-Options: nosniff
  Cross-Origin-Resource-Policy: same-origin
  X-Robots-Tag: noindex
/sym/arasaac/manifest.json
  Cache-Control: no-cache
/sym/arasaac/p/*
  Cache-Control: public, max-age=31536000, immutable
/sym/arasaac/index.*
  Cache-Control: public, max-age=31536000, immutable
/sym/arasaac/forms.*
  Cache-Control: public, max-age=31536000, immutable
"""

Fetch = Callable[[str], bytes]


def https_request(url: str) -> urllib.request.Request:
    """Only https:// URLs built in this package (never file: or other schemes)."""
    if not url.startswith("https://"):
        raise ValueError(f"refusing non-https URL {url!r}")
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})  # noqa: S310


def http_get(url: str, timeout: float = 60.0, attempts: int = 3) -> bytes:
    request = https_request(url)
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return response.read()
        except OSError as err:
            if attempt == attempts:
                raise
            log.warning("GET %s failed (%s), retry %d/%d", url, err, attempt, attempts - 1)
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


@dataclass(frozen=True)
class Pictogram:
    id: int
    keywords: tuple[str, ...]
    role: str
    flags: int
    updated: str


def parse_catalog(catalog: list[dict]) -> list[Pictogram]:
    """Pictograms with at least one Polish keyword (the rest are unsearchable in Polish)."""
    out: list[Pictogram] = []
    for entry in catalog:
        keywords: list[str] = []
        role = "misc"
        for kw in entry.get("keywords") or []:
            text = " ".join(str(kw.get("keyword") or "").split())
            if not text or text in keywords:
                continue
            if not keywords:
                role = ROLE_BY_TYPE.get(kw.get("type"), "misc")
            keywords.append(text)
        if not keywords:
            continue
        flags = (
            (FLAG_AAC if entry.get("aac") else 0)
            | (FLAG_SEX if entry.get("sex") else 0)
            | (FLAG_VIOLENCE if entry.get("violence") else 0)
        )
        out.append(
            Pictogram(
                id=int(entry["_id"]),
                keywords=tuple(keywords[:20]),
                role=role,
                flags=flags,
                updated=str(entry.get("lastUpdated") or ""),
            )
        )
    out.sort(key=lambda p: p.id)
    return out


class ImageCache:
    """cache/state.json maps pictogram id → {updated, file}; images live in cache/webp/."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.images = root / "webp"
        self.images.mkdir(parents=True, exist_ok=True)
        self.state_path = root / "state.json"
        self.state: dict[str, dict[str, str]] = (
            json.loads(self.state_path.read_text("utf-8")) if self.state_path.exists() else {}
        )

    def lookup(self, picto: Pictogram) -> str | None:
        entry = self.state.get(str(picto.id))
        if entry and entry["updated"] == picto.updated and (self.images / entry["file"]).exists():
            return entry["file"]
        return None

    def store(self, picto: Pictogram, webp: bytes) -> str:
        name = f"{picto.id}.{hash8(webp)}.webp"
        (self.images / name).write_bytes(webp)
        self.state[str(picto.id)] = {"updated": picto.updated, "file": name}
        return name

    def save(self, keep_ids: set[int] | None = None) -> None:
        if keep_ids is not None:
            self.state = {k: v for k, v in self.state.items() if int(k) in keep_ids}
            referenced = {v["file"] for v in self.state.values()}
            for path in self.images.iterdir():
                if path.name not in referenced:
                    path.unlink()
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, sort_keys=True), "utf-8")
        tmp.replace(self.state_path)


def sync_images(
    pictos: list[Pictogram], cache: ImageCache, fetch: Fetch, workers: int
) -> tuple[dict[int, str], list[int]]:
    """Return (id → cached file name, ids that failed to download or convert)."""
    files: dict[int, str] = {}
    todo: list[Pictogram] = []
    for picto in pictos:
        cached = cache.lookup(picto)
        if cached:
            files[picto.id] = cached
        else:
            todo.append(picto)
    log.info("images: %d cached, %d to download", len(files), len(todo))

    def work(picto: Pictogram) -> bytes:
        return encode_webp(fetch(IMAGE_URL.format(id=picto.id)), IMAGE_SIZE)

    failed: list[int] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(work, picto): picto for picto in todo}
        for done, future in enumerate(as_completed(futures), start=1):
            picto = futures[future]
            try:
                files[picto.id] = cache.store(picto, future.result())
            except Exception as err:
                log.warning("pictogram %d skipped: %s", picto.id, err)
                failed.append(picto.id)
            if done % 500 == 0:
                cache.save()
                log.info("images: %d/%d downloaded", done, len(todo))
    return files, sorted(failed)


def prepare_out_dir(out: Path) -> Path:
    """Recreate the output directory; refuses to wipe anything it did not create."""
    if out.exists():
        if any(out.iterdir()) and not (out / MARKER).exists():
            raise SystemExit(f"{out} is not empty and has no {MARKER} marker; refusing to delete")
        shutil.rmtree(out)
    set_dir = out / SET_DIR
    (set_dir / "p").mkdir(parents=True)
    (out / MARKER).write_text("generated by tools/build_arasaac.py\n", "utf-8")
    (out / ".assetsignore").write_text(f"{MARKER}\n", "utf-8")  # never uploaded
    (out / "_headers").write_text(HEADERS_FILE, "utf-8")
    return set_dir


def build(
    out: Path,
    cache_dir: Path,
    *,
    catalog: list[dict] | None = None,
    fetch: Fetch = http_get,
    workers: int = 4,
    min_items: int = 10_000,
    limit: int | None = None,
) -> dict[str, object]:
    if catalog is None:
        catalog = json.loads(fetch(CATALOG_URL))
    pictos = parse_catalog(catalog)
    if limit is not None:
        pictos = pictos[:limit]
    if len(pictos) < min_items:
        raise SystemExit(f"catalogue has only {len(pictos)} usable pictograms (< {min_items})")

    cache = ImageCache(cache_dir)
    files, failed = sync_images(pictos, cache, fetch, workers)
    if len(failed) > max(20, len(pictos) // 200):
        cache.save()
        raise SystemExit(f"{len(failed)} pictograms failed; not publishing a partial mirror")
    # Failed ids keep their previous image (if any) and are retried next run.
    keep = {p.id for p in pictos}
    for picto_id in failed:
        previous = cache.state.get(str(picto_id))
        if previous and (cache.images / previous["file"]).exists():
            files[picto_id] = previous["file"]
    cache.save(keep_ids=keep)

    set_dir = prepare_out_dir(out)
    items: list[Item] = []
    for picto in pictos:
        name = files.get(picto.id)
        if not name:
            continue
        shutil.copyfile(cache.images / name, set_dir / "p" / name)
        items.append(
            Item(
                id=picto.id,
                file=f"p/{name}",
                keywords=list(picto.keywords),
                role=picto.role,
                flags=picto.flags,
            )
        )
    manifest = write_index(
        set_dir, SetMeta(set="arasaac", name="ARASAAC", attribution=ATTRIBUTION), items
    )
    log.info(
        "mirror: %d pictograms, %d failed, index %s", len(items), len(failed), manifest["index"]
    )
    return manifest
