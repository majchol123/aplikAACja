"""Build a board template from its TOML spec and the local ARASAAC mirror (PLAN §2.7).

uv run build_template.py --spec template/starter.toml \
    --set-dir ../workers/arasaac/dist/sym/arasaac \
    --out ../templates/starter.json --preview /tmp/starter-preview.html
"""

import argparse
import json
import tomllib
from pathlib import Path

from aplikaacja_tools.arasaac import ATTRIBUTION
from aplikaacja_tools.symbolset import load_index
from aplikaacja_tools.template import SymbolIndex, build_template, render_preview


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--set-dir", type=Path, required=True, help="mirror sym/arasaac directory")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--preview", type=Path, help="write a self-contained HTML preview")
    args = parser.parse_args()

    spec = tomllib.loads(args.spec.read_text("utf-8"))
    index = SymbolIndex(load_index(args.set_dir)["items"])
    template = build_template(spec, index)
    args.out.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", "utf-8")
    if args.preview:
        args.preview.write_text(render_preview(template, index, args.set_dir, ATTRIBUTION), "utf-8")
    print(f"{args.out}: {template['name']}")


if __name__ == "__main__":
    main()
