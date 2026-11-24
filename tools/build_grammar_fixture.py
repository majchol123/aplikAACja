"""Rebuild packages/shared/test-vectors/grammar.json from the real PoliMorf.

uv run build_grammar_fixture.py [--polimorf .cache/polimorf/PoliMorf-0.6.7.tab.gz]

The fixture holds every lemma of the starter template's labels and of grammar/fixture-words.txt,
plus the pronouns and "być": the test vector of the TypeScript grammar reader and the grammar
file of the e2e mirror. tests/test_grammar.py checks it is up to date when PoliMorf is cached.
"""

import argparse
import json
import logging
from pathlib import Path

from aplikaacja_tools import grammar

ROOT = Path(__file__).parents[1]
OUT = ROOT / "packages/shared/test-vectors/grammar.json"
TEMPLATE = ROOT / "templates/starter.json"
WORDS = Path(__file__).parent / "grammar/fixture-words.txt"
POLIMORF = Path(__file__).parent / ".cache/polimorf/PoliMorf-0.6.7.tab.gz"


def template_labels(node: object) -> list[str]:
    if isinstance(node, dict):
        own = [node["label"]] if isinstance(node.get("label"), str) else []
        return own + [label for value in node.values() for label in template_labels(value)]
    if isinstance(node, list):
        return [label for value in node for label in template_labels(value)]
    return []


def fixture_words() -> set[str]:
    words = set()
    for line in WORDS.read_text("utf-8").splitlines():
        if not line.startswith("#"):
            words.update(line.split())
    for label in template_labels(json.loads(TEMPLATE.read_text("utf-8"))):
        words.update(grammar.WORD_RE.findall(label))
    return words


def render(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--polimorf", type=Path, default=POLIMORF)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    built = grammar.fixture(args.polimorf, fixture_words())
    OUT.write_text(render(built.data), "utf-8")
    logging.info("%s: %d lemmas", OUT, len(built.data["lemmas"]))


if __name__ == "__main__":
    main()
