"""Build the ARASAAC mirror (images + search index) into an assets directory.

    uv run build_arasaac.py --out ../workers/arasaac/dist [--cache .cache/arasaac]

Then add the lexicon: uv run build_lexicon.py --set-dir ../workers/arasaac/dist/sym/arasaac
"""

import argparse
import json
import logging
from pathlib import Path

from relaacja_tools import arasaac


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="assets directory to (re)create")
    parser.add_argument("--cache", type=Path, default=Path(".cache/arasaac"))
    parser.add_argument("--catalog", type=Path, help="local copy of /v1/pictograms/all/pl")
    parser.add_argument("--workers", type=int, default=4, help="parallel image downloads")
    parser.add_argument("--min-items", type=int, default=10_000)
    parser.add_argument("--limit", type=int, help="only the first N pictograms (development)")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    catalog = json.loads(args.catalog.read_text("utf-8")) if args.catalog else None
    manifest = arasaac.build(
        args.out,
        args.cache,
        catalog=catalog,
        workers=args.workers,
        min_items=args.min_items if args.limit is None else 0,
        limit=args.limit,
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
