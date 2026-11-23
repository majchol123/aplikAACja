import json
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from relaacja_tools.backup import AGE_MAGIC, BackupError, Client, complete_snapshots, run_backup

TOKEN = "t" * 43


def sealed(name: str) -> bytes:
    return AGE_MAGIC + b"-> X25519 stub\n--- mac\n" + name.encode()


class FakeServer:
    """The backup routes of the Worker, with the data of two accounts."""

    def __init__(self) -> None:
        self.users = {"usera": ["m1", "m2"], "userb": []}
        self.catalog = [{"id": "entry1", "photos": ["k1"]}]
        self.requests: list[str] = []
        self.plaintext: set[str] = set()
        self.failures: dict[str, int] = {}
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # quiet
                pass

            def do_GET(self):
                server.requests.append(self.path)
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    return self.answer(401, b"{}")
                if server.failures.get(self.path, 0) > 0:
                    server.failures[self.path] -= 1
                    return self.answer(503, b"{}")
                body = server.route(self.path)
                if body is None:
                    return self.answer(404, b"{}")
                self.answer(200, body)

            def answer(self, status: int, body: bytes) -> None:
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def route(self, path: str) -> bytes | None:
        if path == "/api/backup/index":
            return json.dumps(
                {"v": 1, "at": 1, "users": list(self.users), "catalog": self.catalog}
            ).encode()
        if path in self.plaintext:
            return b'{"secret": true}'
        if path in ("/api/backup/d1", "/api/backup/catalog"):
            return sealed(path)
        parts = path.split("/")[3:]
        if parts[0] == "catalog" and len(parts) == 4:
            return sealed(path)
        if parts[0] == "users" and parts[1] in self.users:
            if len(parts) == 2:
                return sealed(path)
            if parts[2:] == ["media"]:
                return json.dumps({"media": self.users[parts[1]]}).encode()
            if len(parts) == 4 and parts[3] in self.users[parts[1]]:
                return sealed(path)
        return None

    def close(self) -> None:
        self.httpd.shutdown()


@pytest.fixture
def server():
    s = FakeServer()
    yield s
    s.close()


def client(server: FakeServer, token: str = TOKEN) -> Client:
    return Client(server.origin, token, sleep=lambda _s: None)


def at(minute: int) -> datetime:
    return datetime(2026, 11, 23, 4, minute, tzinfo=UTC)


def test_a_run_stores_every_file_encrypted_and_names_its_photos(server, tmp_path: Path):
    stats = run_backup(client(server), tmp_path, keep=5, now=at(0))
    snap = tmp_path / "snapshots/2026-11-23T04-00-00Z"
    assert (snap / "COMPLETE").is_file()
    assert (snap / "d1.json.age").read_bytes().startswith(AGE_MAGIC)
    assert (snap / "users/usera.json.age").read_bytes().startswith(AGE_MAGIC)
    assert (snap / "users/usera.media").read_text().split() == ["m1", "m2"]
    assert (tmp_path / "media/usera/m2.age").is_file()
    assert (tmp_path / "catalog/entry1/k1.age").is_file()
    assert (stats.users, stats.photos_new, stats.photos_kept) == (2, 3, 0)


def test_photos_are_fetched_once_and_old_snapshots_go_with_their_photos(server, tmp_path: Path):
    run_backup(client(server), tmp_path, keep=2, now=at(0))
    server.requests.clear()
    server.users["usera"] = ["m2", "m3"]  # m1 deleted in the app, m3 added
    stats = run_backup(client(server), tmp_path, keep=2, now=at(1))
    assert "/api/backup/users/usera/media/m2" not in server.requests
    assert (stats.photos_new, stats.photos_kept) == (1, 2)
    assert (tmp_path / "media/usera/m1.age").is_file()  # still named by the first snapshot
    stats = run_backup(client(server), tmp_path, keep=2, now=at(2))
    assert stats.snapshots_removed == ["2026-11-23T04-00-00Z"]
    assert [p.name for p in complete_snapshots(tmp_path)] == [
        "2026-11-23T04-01-00Z",
        "2026-11-23T04-02-00Z",
    ]
    assert not (tmp_path / "media/usera/m1.age").exists()
    assert (tmp_path / "media/usera/m3.age").is_file()


def test_plaintext_is_never_stored(server, tmp_path: Path):
    server.plaintext.add("/api/backup/users/userb")
    with pytest.raises(BackupError, match="not an age file"):
        run_backup(client(server), tmp_path, keep=5, now=at(0))
    snap = tmp_path / "snapshots/2026-11-23T04-00-00Z"
    assert not (snap / "COMPLETE").exists()
    assert not (snap / "users/userb.json.age").exists()
    # The failed run is cleaned up after the next complete one.
    server.plaintext.clear()
    stats = run_backup(client(server), tmp_path, keep=5, now=at(1))
    assert stats.snapshots_removed == ["2026-11-23T04-00-00Z"]


def test_transient_errors_are_retried_and_a_wrong_token_is_not(server, tmp_path: Path):
    server.failures["/api/backup/d1"] = 2
    run_backup(client(server), tmp_path, keep=5, now=at(0))
    assert server.requests.count("/api/backup/d1") == 3
    with pytest.raises(BackupError, match="HTTP 401"):
        run_backup(client(server, token="x" * 43), tmp_path, keep=5, now=at(1))


def test_ids_from_the_server_cannot_leave_the_backup_directory(server, tmp_path: Path):
    server.users = {"../../etc": []}
    with pytest.raises(BackupError, match="unexpected account ID"):
        run_backup(client(server), tmp_path, keep=5, now=at(0))
    assert not (tmp_path.parent / "etc").exists()


def test_the_origin_must_be_https_except_on_this_machine():
    for origin in ("http://relaacja.example", "http://localhost.example", "ftp://x"):
        with pytest.raises(BackupError, match="https"):
            Client(origin, TOKEN)
    for origin in ("https://relaacja.example", "http://localhost:5173", "http://127.0.0.1:9"):
        Client(origin, TOKEN)
