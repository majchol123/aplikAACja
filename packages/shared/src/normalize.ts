/**
 * Text normalization shared with tools/aplikaacja_tools/normalize.py (PLAN §3.3).
 * Both implementations are checked against test-vectors/normalize.json.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Normalized words of `text`. */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}
