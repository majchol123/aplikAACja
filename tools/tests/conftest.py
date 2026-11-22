import io
import json
from pathlib import Path

import pytest
from PIL import Image

SHARED_VECTORS = Path(__file__).parents[2] / "packages/shared/test-vectors"


def png(color: tuple[int, int, int], size: int = 64) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (size, size), (*color, 255)).save(out, "PNG")
    return out.getvalue()


CATALOG = [
    {
        "_id": 2462,
        "lastUpdated": "2020-01-01",
        "aac": True,
        "sex": False,
        "violence": False,
        "keywords": [{"keyword": "jabłko", "type": 2}],
    },
    {
        "_id": 9057,
        "lastUpdated": "2020-01-01",
        "aac": False,
        "sex": False,
        "violence": False,
        "keywords": [
            {"keyword": "ciasto", "type": 2},
            {"keyword": "ciasto z jabłkami", "type": 2},
            {"keyword": "ciasto", "type": 2},
        ],
    },
    {
        "_id": 11403,
        "lastUpdated": "2021-05-05",
        "keywords": [{"keyword": "sok  jabłkowy", "type": 2}],
    },
    {
        "_id": 6061,
        "lastUpdated": "2020-01-01",
        "aac": True,
        "keywords": [{"keyword": "pić", "type": 3}],
    },
    {"_id": 2727, "lastUpdated": "2020-01-01", "keywords": [{"keyword": "nos", "type": 2}]},
    {"_id": 30000, "lastUpdated": "2024-01-01", "keywords": [{"keyword": "nos", "type": 2}]},
    {
        "_id": 5000,
        "lastUpdated": "2020-01-01",
        "sex": True,
        "keywords": [{"keyword": "całować", "type": 3}],
    },
    {
        "_id": 5001,
        "lastUpdated": "2020-01-01",
        "violence": True,
        "keywords": [{"keyword": "bić", "type": 3}],
    },
    {"_id": 7000, "lastUpdated": "2020-01-01", "keywords": [{"keyword": "dzień dobry", "type": 5}]},
    {"_id": 7001, "lastUpdated": "2020-01-01", "keywords": [{"keyword": "Ola", "type": 1}]},
    {"_id": 7002, "lastUpdated": "2020-01-01", "keywords": [{"keyword": "co?", "type": None}]},
    {"_id": 9999, "lastUpdated": "2020-01-01", "keywords": []},
]

POLIMORF = """\
jabłko\tjabłko\tsubst:sg:nom:n2\tpospolita
jabłka\tjabłko\tsubst:sg:gen:n2\tpospolita
jabłka\tjabłka\tsubst:pl:nom:p3\tpospolita
jabłkami\tjabłko\tsubst:pl:inst:n2\tpospolita
jabłkowy\tjabłkowy\tadj:sg:nom:m1:pos\tpospolita
jabłkowego\tjabłkowy\tadj:sg:gen:m1:pos\tpospolita
pić\tpić\tinf:imperf\tpospolita
piję\tpić\tfin:sg:pri:imperf\tpospolita
piłem\tpić\tpraet:sg:m1:imperf\tpospolita
nosa\tnos\tsubst:sg:gen:m3\tpospolita
nosa\tnosić\timpt:sg:sec:imperf\tpospolita
mam\tmama\tsubst:pl:gen:f\tpospolita
mam\tmieć\tfin:sg:pri:imperf\tpospolita
ciasta\tciasto\tsubst:sg:gen:n2\tpospolita
dnia\tdzień\tsubst:sg:gen:m3\tpospolita
dobrego\tdobry\tadj:sg:gen:m1:pos\tpospolita
całuje\tcałować\tfin:sg:ter:imperf\tpospolita
bije\tbić\tfin:sg:ter:imperf\tpospolita
kot\tkot\tsubst:sg:nom:m2\tpospolita
kota\tkot\tsubst:sg:gen:m2\tpospolita
"""


class FakeHttp:
    """Serves the catalogue and deterministic PNGs; records every requested URL."""

    def __init__(self, catalog: list[dict] | None = None, broken: set[int] | None = None) -> None:
        self.catalog = catalog if catalog is not None else CATALOG
        self.broken = broken or set()
        self.requests: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.requests.append(url)
        if url.endswith("/all/pl"):
            return json.dumps(self.catalog).encode()
        picto_id = int(url.rsplit("/", 2)[-2])
        if picto_id in self.broken:
            return b"not an image"
        return png((picto_id % 256, (picto_id // 256) % 256, 128))


@pytest.fixture
def polimorf(tmp_path: Path) -> Path:
    path = tmp_path / "polimorf.tab"
    path.write_text(POLIMORF, "utf-8")
    return path
