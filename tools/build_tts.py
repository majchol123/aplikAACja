"""Build the Piper TTS static assets Worker directory (runtime + chunked Polish voices).

uv run build_tts.py --out ../workers/tts/dist --node-modules ../app/node_modules
"""

import argparse
import json
import logging
from pathlib import Path

from aplikaacja_tools import tts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="assets directory to (re)create")
    parser.add_argument("--cache", type=Path, default=Path(".cache/tts"))
    parser.add_argument("--node-modules", type=Path, default=Path("../app/node_modules"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    manifest = tts.build(args.out, args.cache, args.node_modules)
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
