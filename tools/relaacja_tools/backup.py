"""Client of the encrypted backup routes (PLAN §6, F7).

The server encrypts every file for the age recipient set in the admin panel, so this
client never sees plaintext and needs no key: it stores what it gets and refuses anything
that is not an age file. Layout of the backup directory:

    snapshots/<UTC time>/index.json           plain: opaque IDs only
    snapshots/<UTC time>/d1.json.age          accounts, audit log, folder pictures
    snapshots/<UTC time>/catalog.json.age     catalogue entries
    snapshots/<UTC time>/users/<id>.json.age  one vault: boards, tiles, settings, …
    snapshots/<UTC time>/users/<id>.media     plain: photo IDs of that vault
    snapshots/<UTC time>/COMPLETE             written last
    media/<user id>/<photo id>.age            photos never change: fetched once
    catalog/<entry id>/<key>.age

Only complete snapshots count; the newest `keep` of them stay, with the photos they name,
and none older than `max_age` (the privacy policy promises that a deleted account leaves the
backups within 30 days).
"""

from __future__ import annotations

import json
import re
import shutil
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

AGE_MAGIC = b"age-encryption.org/v1\n"
MAX_AGE = timedelta(days=30)
STAMP = "%Y-%m-%dT%H-%M-%SZ"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
USER_AGENT = "relaacja-backup/1"


class BackupError(Exception):
    pass


@dataclass
class Stats:
    users: int = 0
    photos_new: int = 0
    photos_kept: int = 0
    snapshots_removed: list[str] = field(default_factory=list)


def _safe(value: object, what: str) -> str:
    """IDs become file names: nothing but letters, digits, '-' and '_'."""
    if not isinstance(value, str) or not SAFE_ID.match(value):
        raise BackupError(f"unexpected {what} from the server: {value!r}")
    return value


class Client:
    def __init__(
        self,
        origin: str,
        token: str,
        *,
        retries: int = 4,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = 60,
    ) -> None:
        local = re.match(r"^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$", origin)
        if not origin.startswith("https://") and not local:
            raise BackupError("the origin must be https:// (or http://localhost for tests)")
        self.origin = origin.rstrip("/")
        self.token = token
        self.retries = retries
        self.sleep = sleep
        self.timeout = timeout

    def get(self, path: str) -> bytes:
        request = urllib.request.Request(  # noqa: S310 - the scheme is checked above
            self.origin + path,
            headers={"Authorization": f"Bearer {self.token}", "User-Agent": USER_AGENT},
        )
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310  # nosec B310 - scheme checked in __init__
                    return response.read()
            except urllib.error.HTTPError as err:
                if err.code in (429, 500, 502, 503, 504) and attempt < self.retries:
                    self.sleep(2**attempt)
                    continue
                raise BackupError(f"GET {path}: HTTP {err.code}") from err
            except urllib.error.URLError as err:
                if attempt < self.retries:
                    self.sleep(2**attempt)
                    continue
                raise BackupError(f"GET {path}: {err.reason}") from err
        raise BackupError(f"GET {path}: no answer")

    def json(self, path: str) -> dict:
        try:
            return json.loads(self.get(path))
        except ValueError as err:
            raise BackupError(f"GET {path}: not JSON") from err

    def sealed(self, path: str) -> bytes:
        data = self.get(path)
        if not data.startswith(AGE_MAGIC):
            # Never store what the server did not encrypt.
            raise BackupError(f"GET {path}: not an age file")
        return data


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_bytes(data)
    partial.replace(path)


def run_backup(
    client: Client,
    out: Path,
    *,
    keep: int,
    max_age: timedelta = MAX_AGE,
    now: datetime | None = None,
) -> Stats:
    stats = Stats()
    now = now or datetime.now(UTC)
    stamp = now.strftime(STAMP)
    snapshot = out / "snapshots" / stamp
    if snapshot.exists():
        raise BackupError(f"{snapshot} exists")

    index = client.json("/api/backup/index")
    if index.get("v") != 1:
        raise BackupError("unknown index version")
    users = [_safe(u, "account ID") for u in index["users"]]
    catalog = [
        (_safe(e["id"], "catalogue ID"), [_safe(k, "photo key") for k in e["photos"]])
        for e in index["catalog"]
    ]
    _write(snapshot / "index.json", json.dumps(index, indent=1).encode())
    _write(snapshot / "d1.json.age", client.sealed("/api/backup/d1"))
    _write(snapshot / "catalog.json.age", client.sealed("/api/backup/catalog"))
    for entry, keys in catalog:
        for key in keys:
            target = out / "catalog" / entry / f"{key}.age"
            if target.exists():
                stats.photos_kept += 1
                continue
            _write(target, client.sealed(f"/api/backup/catalog/{entry}/photos/{key}"))
            stats.photos_new += 1

    for user in users:
        _write(snapshot / "users" / f"{user}.json.age", client.sealed(f"/api/backup/users/{user}"))
        media = [
            _safe(m, "photo ID") for m in client.json(f"/api/backup/users/{user}/media")["media"]
        ]
        _write(snapshot / "users" / f"{user}.media", "\n".join(media).encode())
        for photo in media:
            target = out / "media" / user / f"{photo}.age"
            if target.exists():
                stats.photos_kept += 1
                continue
            _write(target, client.sealed(f"/api/backup/users/{user}/media/{photo}"))
            stats.photos_new += 1
        stats.users += 1

    _write(snapshot / "COMPLETE", stamp.encode())
    stats.snapshots_removed = prune(out, keep=keep, max_age=max_age, now=now)
    return stats


def complete_snapshots(out: Path) -> list[Path]:
    root = out / "snapshots"
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if (p / "COMPLETE").is_file())


def _taken(snapshot: Path) -> datetime:
    try:
        return datetime.strptime(snapshot.name, STAMP).replace(tzinfo=UTC)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)  # not ours: as good as expired


def prune(
    out: Path, *, keep: int, max_age: timedelta = MAX_AGE, now: datetime | None = None
) -> list[str]:
    """Keeps the newest `keep` complete snapshots younger than `max_age` and their photos.

    The age limit holds even when no new snapshot could be made: an old snapshot is removed
    although nothing replaces it (the job reports every failed run long before that).
    """
    if keep < 1:
        raise BackupError("keep at least one snapshot")
    cutoff = (now or datetime.now(UTC)) - max_age
    snapshots = complete_snapshots(out)
    kept = [p for p in snapshots[-keep:] if _taken(p) >= cutoff]
    removed = []
    newest = kept[-1] if kept else None
    for path in sorted((out / "snapshots").iterdir()) if (out / "snapshots").is_dir() else []:
        # Incomplete snapshots older than the newest complete one are failed runs.
        failed = not (path / "COMPLETE").is_file() and newest is not None and path < newest
        expired = _taken(path) < cutoff
        if (path in snapshots and path not in kept) or failed or expired:
            shutil.rmtree(path)
            removed.append(path.name)
    referenced: set[tuple[str, str]] = set()
    entries: set[tuple[str, str]] = set()
    for path in kept:
        for listing in (path / "users").glob("*.media"):
            user = listing.name.removesuffix(".media")
            referenced.update((user, m) for m in listing.read_text().split())
        index = json.loads((path / "index.json").read_text())
        entries.update((e["id"], k) for e in index["catalog"] for k in e["photos"])
    _collect(out / "media", referenced)
    _collect(out / "catalog", entries)
    return removed


def _collect(root: Path, keep: set[tuple[str, str]]) -> None:
    if not root.is_dir():
        return
    for owner in root.iterdir():
        for partial in owner.glob("*.partial"):
            partial.unlink()
        for photo in owner.glob("*.age"):
            if (owner.name, photo.name.removesuffix(".age")) not in keep:
                photo.unlink()
        if not any(owner.iterdir()):
            owner.rmdir()
