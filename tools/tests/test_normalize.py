import json
from pathlib import Path

import pytest

from aplikaacja_tools.normalize import normalize, tokens

VECTORS = json.loads(
    (Path(__file__).parents[2] / "packages/shared/test-vectors/normalize.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=lambda c: repr(c["in"]))
def test_shared_vectors(case: dict[str, str]) -> None:
    assert normalize(case["in"]) == case["out"]


def test_tokens() -> None:
    assert tokens(" Ciasto z jabłkami! ") == ["ciasto", "z", "jablkami"]
    assert tokens("?!") == []
