"""Text normalization shared with packages/shared/src/normalize.ts.

Both implementations are checked against packages/shared/test-vectors/normalize.json.
"""

import unicodedata


def normalize(text: str) -> str:
    """Lowercase, fold Polish diacritics (incl. ł), drop punctuation, collapse spaces."""
    lowered = text.lower().replace("ł", "l")
    out: list[str] = []
    for ch in unicodedata.normalize("NFKD", lowered):
        category = unicodedata.category(ch)[0]
        if category == "M":
            continue
        out.append(ch if category in ("L", "N") else " ")
    return " ".join("".join(out).split())


def tokens(text: str) -> list[str]:
    """Normalized words of `text`."""
    normalized = normalize(text)
    return normalized.split(" ") if normalized else []
