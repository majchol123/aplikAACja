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
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from .symbolset import (
    FLAG_AAC,
    FLAG_SEX,
    FLAG_VIOLENCE,
    MAX_CATEGORY_NAME,
    Category,
    Item,
    SetMeta,
    canonical_json,
    encode_webp,
    hash8,
    write_index,
)

log = logging.getLogger(__name__)

CATALOG_URL = "https://api.arasaac.org/v1/pictograms/all/pl"
# Undocumented: the Polish category tree arasaac.org itself uses (PLAN §3.3). Pictograms
# name its keys in `categories`; when it fails, the copy from the previous run is used.
CATEGORIES_URL = "https://privateapi.arasaac.org/api/categories/pl"
CATEGORY_CACHE = "categories.json"
MAX_CATEGORY_DEPTH = 12
IMAGE_URL = "https://static.arasaac.org/pictograms/{id}/{id}_500.png"
USER_AGENT = "symbol-mirror/1.0"
IMAGE_SIZE = 500
SET_DIR = Path("sym") / "arasaac"
MARKER = ".relaacja-symbols"

ATTRIBUTION = (
    "Autor symboli: Sergio Palao. Pochodzenie: ARASAAC (https://arasaac.org). "
    "Licencja: CC (BY-NC-SA). Właściciel: Rząd Aragonii (Hiszpania)."
)

# ARASAAC keyword.type → Fitzgerald Key role (PLAN §3.3).
ROLE_BY_TYPE = {1: "person", 2: "noun", 3: "verb", 4: "descriptor", 5: "social", 6: "misc"}

# Content filter "sexuality" (PLAN §3.3): ARASAAC's own `sex` field marks "penis" but not
# "vagina", "ovaries", "menstruation" or "pregnancy", so these category subtrees count too
# (keys of the ARASAAC category tree). "gender identity" (male, female, gender) and
# "sexual crime" (hit, kick: vocabulary for disclosing harm) deliberately stay outside.
SEXUAL_CATEGORIES = frozenset(
    {
        "sexuality",
        "sexual orientation",
        "sexual practice",
        "contraceptive method",
        "reproductive system",
        "human reproduction",
    }
)

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
/sym/arasaac/categories.*
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
    categories: tuple[str, ...] = ()  # keys of the ARASAAC category tree


def is_sexual(entry: dict) -> bool:
    categories = entry.get("categories") or []
    return any(isinstance(c, str) and c in SEXUAL_CATEGORIES for c in categories)


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
            | (FLAG_SEX if entry.get("sex") or is_sexual(entry) else 0)
            | (FLAG_VIOLENCE if entry.get("violence") else 0)
        )
        out.append(
            Pictogram(
                id=int(entry["_id"]),
                keywords=tuple(keywords[:20]),
                role=role,
                flags=flags,
                updated=str(entry.get("lastUpdated") or ""),
                categories=tuple(
                    dict.fromkeys(c for c in entry.get("categories") or [] if isinstance(c, str))
                ),
            )
        )
    out.sort(key=lambda p: p.id)
    return out


@dataclass(frozen=True)
class TreeNode:
    key: str
    name: str
    children: tuple[TreeNode, ...]


def parse_category_tree(payload: object) -> tuple[TreeNode, ...]:
    """Check the shape of {locale, data: {key: {text, children: {...}}}}; keys are unique."""
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise ValueError("category tree: no data object")
    seen: set[str] = set()

    def nodes(children: object, depth: int) -> tuple[TreeNode, ...]:
        if not isinstance(children, dict):
            raise ValueError("category tree: children is not an object")
        if depth > MAX_CATEGORY_DEPTH:
            raise ValueError("category tree: too deep")
        out: list[TreeNode] = []
        for key, node in children.items():
            if not isinstance(node, dict) or not key or key in seen:
                raise ValueError(f"category tree: bad or repeated node {key!r}")
            seen.add(key)
            name = " ".join(str(node.get("text") or "").split()) or key
            kids = nodes(node.get("children") or {}, depth + 1)
            out.append(TreeNode(key, name[:MAX_CATEGORY_NAME], kids))
        return tuple(out)

    roots = nodes(payload["data"], 1)
    if not roots:
        raise ValueError("category tree: empty")
    return roots


def load_category_tree(fetch: Fetch, cache_dir: Path) -> tuple[TreeNode, ...]:
    """The live tree, else the copy kept by the previous run: never a mirror without one."""
    cached = cache_dir / CATEGORY_CACHE
    try:
        payload = json.loads(fetch(CATEGORIES_URL))
        roots = parse_category_tree(payload)
    except (OSError, ValueError) as err:
        if not cached.exists():
            msg = f"category tree unavailable ({err}) and no copy from a previous run"
            raise SystemExit(msg) from err
        log.warning("category tree unavailable (%s); using the copy from the previous run", err)
        return parse_category_tree(json.loads(cached.read_text("utf-8")))
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(canonical_json(payload))
    return roots


def pick_icon(name: str, direct: Sequence[Pictogram], members: Sequence[Pictogram]) -> int:
    """Folder picture: a symbol named like the folder, else one of its own, preferably core
    vocabulary (`aac`) and never a filtered one while an unfiltered one exists."""
    clean = [p for p in members if not p.flags & (FLAG_SEX | FLAG_VIOLENCE)] or list(members)
    wanted = name.casefold()
    own = {p.id for p in direct}
    for group in (
        [p for p in clean if p.keywords[0].casefold() == wanted],
        [p for p in clean if any(k.casefold() == wanted for k in p.keywords)],
        [p for p in clean if p.id in own],
        clean,
    ):
        if group:
            return next((p for p in group if p.flags & FLAG_AAC), group[0]).id
    raise ValueError(f"category {name!r} has no symbols")


def category_tree(
    roots: Sequence[TreeNode], pictos: Sequence[Pictogram]
) -> tuple[list[Category], dict[int, tuple[int, ...]]]:
    """Folders holding at least one pictogram, numbered in tree order, and each pictogram's
    folders. A pictogram may sit in several folders and in inner folders too."""
    direct: dict[str, list[Pictogram]] = {}
    for picto in pictos:
        for key in picto.categories:
            direct.setdefault(key, []).append(picto)

    subtree: dict[str, list[Pictogram]] = {}

    def collect(node: TreeNode) -> list[Pictogram]:
        found = {p.id: p for p in direct.get(node.key, [])}
        for child in node.children:
            for picto in collect(child):
                found.setdefault(picto.id, picto)
        subtree[node.key] = sorted(found.values(), key=lambda p: p.id)
        return subtree[node.key]

    nodes: list[Category] = []
    ids: dict[str, int] = {}

    def emit(node: TreeNode, parent: int | None) -> None:
        members = subtree[node.key]
        if not members:
            return
        ids[node.key] = node_id = len(nodes) + 1
        icon = pick_icon(node.name, direct.get(node.key, []), members)
        nodes.append(Category(id=node_id, name=node.name, parent=parent, icon=icon))
        for child in node.children:
            emit(child, node_id)

    for root in roots:
        collect(root)
        emit(root, None)
    membership = {p.id: tuple(ids[k] for k in p.categories if k in ids) for p in pictos}
    return nodes, {picto_id: g for picto_id, g in membership.items() if g}


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
    roots = load_category_tree(fetch, cache_dir)

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
    published = [p for p in pictos if p.id in files]
    categories, membership = category_tree(roots, published)
    items: list[Item] = []
    for picto in published:
        name = files[picto.id]
        shutil.copyfile(cache.images / name, set_dir / "p" / name)
        items.append(
            Item(
                id=picto.id,
                file=f"p/{name}",
                keywords=list(picto.keywords),
                role=picto.role,
                flags=picto.flags,
                categories=membership.get(picto.id, ()),
            )
        )
    manifest = write_index(
        set_dir,
        SetMeta(set="arasaac", name="ARASAAC", attribution=ATTRIBUTION),
        items,
        categories,
    )
    log.info(
        "mirror: %d pictograms, %d failed, %d categories, index %s",
        len(items),
        len(failed),
        len(categories),
        manifest["index"],
    )
    return manifest
