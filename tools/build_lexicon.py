"""Add the PoliMorf lexicons (forms.<hash>.json, grammar.<hash>.json) to a built symbol set.

uv run build_lexicon.py --set-dir ../workers/arasaac/dist/sym/arasaac [--report]

forms: normalized forms for search (PLAN D10); grammar: tagged forms for inflecting sentences
(PLAN §2.10). --report lists vocabulary lemmas whose spoken forms are still ambiguous, to be
settled in grammar/variants.toml.
"""

import argparse
import json
import logging
import urllib.request
from pathlib import Path

from aplikaacja_tools import grammar, lexicon
from aplikaacja_tools.arasaac import https_request


def fetch_polimorf(cache: Path) -> Path:
    path = cache / lexicon.POLIMORF_FILE
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        logging.info("downloading %s", lexicon.POLIMORF_URL)
        request = https_request(lexicon.POLIMORF_URL)
        tmp = path.with_suffix(".part")
        with urllib.request.urlopen(request, timeout=300) as response, tmp.open("wb") as fh:  # noqa: S310
            while chunk := response.read(1 << 20):
                fh.write(chunk)
        tmp.replace(path)
    lexicon.verify_sha256(path, lexicon.POLIMORF_SHA256)
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set-dir", type=Path, required=True, help="directory with manifest.json")
    parser.add_argument("--polimorf", type=Path, help="PoliMorf .tab.gz (downloaded if omitted)")
    parser.add_argument("--cache", type=Path, default=Path(".cache/polimorf"))
    parser.add_argument(
        "--report", action="store_true", help="list ambiguous spoken forms of the vocabulary"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    polimorf = args.polimorf or fetch_polimorf(args.cache)
    lexicon.write_lexicon(args.set_dir, polimorf)
    manifest, built = grammar.write_grammar(args.set_dir, polimorf)
    if args.report:
        for lemma, tag, forms in built.ambiguous:
            print(f"{lemma}\t{tag}\t{' '.join(forms)}")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
