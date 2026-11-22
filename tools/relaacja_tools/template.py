"""Board templates (PLAN §2.7): TOML spec + symbol index → templates/<name>.json + HTML preview.

Spec format (tools/template/*.toml):

    name = "Start"
    rows = 4
    cols = 6
    words = ["ja@person", "chcę|chcieć", "nie chcę#6156@negation", "-"]

    [[folders]]
    tile = "Jedzenie"          # same token syntax as words
    rows = 4                   # sub-board grid, default 4 rows, 5 columns
    cols = 5
    words = [...]
      [[folders.folders]]      # nested folders
      tile = "Śniadanie"

Token: ``label[|lookup][#id][@role]``; ``-`` leaves a cell empty. Without ``#id`` the symbol is
the best exact keyword match for ``lookup`` (default: the label): main keyword first, then the
ARASAAC core-vocabulary flag, then keyword position, then index order. Words come first in
reading order, folders after them.
"""

from __future__ import annotations

import base64
import html
import re
from dataclasses import dataclass
from pathlib import Path

from .normalize import normalize
from .symbolset import FLAG_AAC, ROLES

DEFAULT_SUB_GRID = (4, 5)
MAX_DEPTH = 10
TOKEN = re.compile(
    r"^(?P<label>[^|#@]+)(?:\|(?P<lookup>[^|#@]+))?(?:#(?P<id>\d+))?(?:@(?P<role>\w+))?$"
)
# Breadcrumb separator and multiplication sign, spelled out (ruff RUF001).
CRUMB = " \u203a "
TIMES = "\u00d7"

# Same palette as the app (app/src/client/boards/colors.ts, Tailwind 400/500 shades).
ROLE_COLOR = {
    "person": "#facc15",
    "noun": "#fb923c",
    "verb": "#22c55e",
    "descriptor": "#0ea5e9",
    "social": "#f472b6",
    "question": "#a855f7",
    "negation": "#ef4444",
    "misc": "#94a3b8",
}


class TemplateError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    label: str
    lookup: str
    id: int | None
    role: str | None


def parse_token(raw: str) -> Token | None:
    """None for an empty cell."""
    text = " ".join(raw.split())
    if text == "-":
        return None
    m = TOKEN.match(text)
    if not m:
        raise TemplateError(f"bad token {raw!r}")
    role = m["role"]
    if role is not None and role not in ROLES:
        raise TemplateError(f"{raw!r}: unknown role {role!r}")
    label = m["label"].strip()
    return Token(
        label=label,
        lookup=(m["lookup"] or label).strip(),
        id=int(m["id"]) if m["id"] else None,
        role=role,
    )


class SymbolIndex:
    """Exact-keyword lookup over a set index (index.<hash>.json items)."""

    def __init__(self, items: list[dict]) -> None:
        self.by_id = {item["id"]: item for item in items}
        self.by_word: dict[str, list[tuple[tuple[int, int, int, int], dict]]] = {}
        for order, item in enumerate(items):
            core = 0 if item.get("x", 0) & FLAG_AAC else 1
            for position, keyword in enumerate(item["k"]):
                rank = (0 if position == 0 else 1, core, position, order)
                self.by_word.setdefault(normalize(keyword), []).append((rank, item))

    def resolve(self, token: Token) -> dict:
        if token.id is not None:
            item = self.by_id.get(token.id)
            if item is None:
                raise TemplateError(f"{token.label!r}: no symbol #{token.id} in the index")
            return item
        found = sorted(self.by_word.get(normalize(token.lookup), []), key=lambda c: c[0])
        if not found:
            raise TemplateError(f"{token.label!r}: no exact match for {token.lookup!r}; add #id")
        return found[0][1]


def _tile(token: Token, item: dict, row: int, col: int) -> dict:
    return {
        "row": row,
        "col": col,
        "label": token.label,
        "symbol": {"set": "arasaac", "ref": str(item["id"])},
        "colorRole": token.role or item["r"],
    }


def _board(spec: dict, index: SymbolIndex, grid: tuple[int, int], path: str, depth: int) -> dict:
    if depth > MAX_DEPTH:
        raise TemplateError(f"{path}: deeper than {MAX_DEPTH} levels")
    rows, cols = spec.get("rows", grid[0]), spec.get("cols", grid[1])
    cells: list[dict | None] = []
    for raw in spec.get("words", []):
        token = parse_token(raw)
        cells.append(None if token is None else _tile(token, index.resolve(token), 0, 0))
    for folder in spec.get("folders", []):
        token = parse_token(folder["tile"])
        if token is None:
            raise TemplateError(f"{path}: a folder needs a tile")
        tile = _tile(token, index.resolve(token), 0, 0)
        tile["kind"] = "folder"
        where = f"{path}{CRUMB}{token.label}"
        tile["board"] = _board(folder, index, DEFAULT_SUB_GRID, where, depth + 1)
        cells.append(tile)
    if len(cells) > rows * cols:
        raise TemplateError(f"{path}: {len(cells)} tiles do not fit a {rows} {TIMES} {cols} grid")
    tiles = []
    for n, tile in enumerate(cells):
        if tile is not None:
            tile["row"], tile["col"] = divmod(n, cols)
            tiles.append(tile)
    return {"rows": rows, "cols": cols, "tiles": tiles}


def build_template(spec: dict, index: SymbolIndex) -> dict:
    name = spec.get("name", "Start")
    return {"v": 1, "name": name, "board": _board(spec, index, (4, 6), name, 0)}


def _walk(board: dict, title: str, out: list[tuple[str, dict]]) -> None:
    out.append((title, board))
    for tile in board["tiles"]:
        if "board" in tile:
            _walk(tile["board"], f"{title}{CRUMB}{tile['label']}", out)


def render_preview(template: dict, index: SymbolIndex, set_dir: Path, attribution: str) -> str:
    """Self-contained HTML (images inlined) for reviewing a template before it ships."""
    boards: list[tuple[str, dict]] = []
    _walk(template["board"], template["name"], boards)
    tile_count = sum(len(b["tiles"]) for _, b in boards)
    sections = []
    for title, board in boards:
        cells = {(t["row"], t["col"]): t for t in board["tiles"]}
        html_cells = []
        for r in range(board["rows"]):
            for c in range(board["cols"]):
                tile = cells.get((r, c))
                if tile is None:
                    html_cells.append('<div class="cell empty"></div>')
                    continue
                item = index.by_id[int(tile["symbol"]["ref"])]
                data = base64.b64encode((set_dir / item["f"]).read_bytes()).decode()
                folder = ' <span class="folder">📁</span>' if tile.get("kind") == "folder" else ""
                color = ROLE_COLOR[tile["colorRole"]]
                html_cells.append(
                    f'<div class="cell" style="border-color:{color}">'
                    f'<img alt="" src="data:image/webp;base64,{data}">'
                    f"<span>{html.escape(tile['label'])}{folder}</span>"
                    f"<small>#{item['id']} · {html.escape(', '.join(item['k'][:3]))}</small></div>"
                )
        sections.append(
            f"<section><h2>{html.escape(title)} "
            f"<small>{board['rows']} {TIMES} {board['cols']}</small></h2>"
            f'<div class="grid" style="grid-template-columns:repeat({board["cols"]},1fr)">'
            + "".join(html_cells)
            + "</div></section>"
        )
    legend = "".join(
        f'<span style="border-color:{color}">{role}</span>' for role, color in ROLE_COLOR.items()
    )
    return f"""<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Szablon: {html.escape(template["name"])}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:24px;background:#f1f5f9;color:#1e293b}}
h1{{margin:0 0 4px}} h2{{margin:28px 0 8px;font-size:20px}}
h2 small{{color:#64748b;font-weight:400}}
.grid{{display:grid;gap:8px;max-width:760px}}
.cell{{background:#fff;border:5px solid #cbd5e1;border-radius:14px;padding:6px;display:flex;
flex-direction:column;align-items:center;aspect-ratio:1/1;min-width:0}}
.cell img{{width:100%;flex:1;min-height:0;object-fit:contain}}
.cell span{{font-weight:700;font-size:16px;text-align:center}}
.cell small{{color:#94a3b8;font-size:10px;text-align:center;overflow:hidden;white-space:nowrap;
text-overflow:ellipsis;max-width:100%}}
.empty{{background:transparent;border:2px dashed #cbd5e1}}
.legend span{{display:inline-block;border:4px solid;border-radius:8px;padding:2px 8px;
margin:2px;background:#fff}}
footer{{margin-top:32px;color:#64748b;font-size:12px}}
</style></head><body>
<h1>Szablon „{html.escape(template["name"])}”</h1>
<p>{len(boards)} tablic, {tile_count} kafelków.
Pod kafelkiem: numer symbolu ARASAAC i jego hasła.</p>
<p class="legend">{legend}</p>
{"".join(sections)}
<footer>{html.escape(attribution)}</footer>
</body></html>
"""
