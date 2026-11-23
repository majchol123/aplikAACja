import type { FitzgeraldRole } from '@relaacja/shared';
import { ARASAAC_NOTE } from '../library/attribution.ts';

/** One card of the generated phrase, as drawn. */
export interface Card {
  label: string;
  /** Same-origin picture, or null (label only). */
  src: string | null;
  border: string;
  background: string;
}

/** Fitzgerald colours as plain CSS for the canvas (the app's palette, colors.ts). */
export const ROLE_CSS: Record<FitzgeraldRole | 'none', { border: string; background: string }> = {
  person: { border: '#facc15', background: '#fef08a' },
  noun: { border: '#fb923c', background: '#fed7aa' },
  verb: { border: '#22c55e', background: '#bbf7d0' },
  descriptor: { border: '#0ea5e9', background: '#bae6fd' },
  social: { border: '#f472b6', background: '#fbcfe8' },
  question: { border: '#a855f7', background: '#e9d5ff' },
  negation: { border: '#ef4444', background: '#fecaca' },
  misc: { border: '#94a3b8', background: '#e2e8f0' },
  none: { border: '#cbd5e1', background: '#ffffff' },
};

/** Words of `text` in lines no wider than `max` at the context's current font. */
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && g.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The phrase as a PNG (PLAN §2.3): cards in rows of up to six, labels above or below,
 * and the ARASAAC credit under them when one of its symbols is shown.
 */
export async function phrasePng(
  cards: Card[],
  { labelTop, uppercase, credit }: { labelTop: boolean; uppercase: boolean; credit: boolean },
): Promise<Blob> {
  const size = 200;
  const gap = 16;
  const pad = 24;
  const perRow = Math.min(6, Math.max(1, cards.length));
  const rows = Math.ceil(cards.length / perRow);
  const line = 22;
  const font = getComputedStyle(document.documentElement).fontFamily;
  const canvas = document.createElement('canvas');
  canvas.width = pad * 2 + perRow * size + (perRow - 1) * gap;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('canvas unavailable');
  g.font = `400 16px ${font}`;
  const credits = credit ? wrap(g, ARASAAC_NOTE, canvas.width - pad * 2) : [];
  const footer = credits.length > 0 ? 12 + credits.length * line : 0;
  // Setting the height resets the context, fonts included.
  canvas.height = pad * 2 + rows * size + (rows - 1) * gap + footer;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const images = await Promise.all(cards.map((c) => (c.src ? load(c.src) : Promise.resolve(null))));
  cards.forEach((card, i) => {
    const x = pad + (i % perRow) * (size + gap);
    const y = pad + Math.floor(i / perRow) * (size + gap);
    g.fillStyle = card.background;
    g.strokeStyle = card.border;
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(x + 4, y + 4, size - 8, size - 8, 16);
    g.fill();
    g.stroke();
    const text = uppercase ? card.label.toLocaleUpperCase('pl') : card.label;
    g.fillStyle = '#0f172a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let fontSize = 28;
    g.font = `700 ${fontSize}px ${font}`;
    while (g.measureText(text).width > size - 28 && fontSize > 12) {
      fontSize -= 2;
      g.font = `700 ${fontSize}px ${font}`;
    }
    const labelY = labelTop ? y + 30 : y + size - 30;
    g.fillText(text, x + size / 2, labelY, size - 24);
    const img = images[i];
    if (img) {
      const box = size - 76;
      const top = labelTop ? y + 52 : y + 18;
      const scale = Math.min(box / img.width, box / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      g.drawImage(img, x + (size - w) / 2, top + (box - h) / 2, w, h);
    }
  });
  g.fillStyle = '#475569';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `400 16px ${font}`;
  credits.forEach((text, i) => {
    g.fillText(text, pad, canvas.height - pad - footer + 12 + line * i + line / 2);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png failed'))), 'image/png'),
  );
}
