// Renders the PWA icons in public/icons/ from public/favicon.svg (run after changing it):
//   PW_CHROMIUM_PATH=/path/to/chrome node scripts/build-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'public/favicon.svg'), 'utf8');
const glyph = svg.replace(/<rect width="64" height="64" rx="16" fill="#196862"\/>/, '');
if (glyph === svg) throw new Error('favicon.svg background not found');

// "any": the rounded favicon on a transparent canvas. "maskable" and Apple: full-bleed
// background, the glyph inside the 80 % safe zone (platforms crop to circles or squircles).
const icons = [
  { file: 'icon-192.png', size: 192, full: false },
  { file: 'icon-512.png', size: 512, full: false },
  { file: 'maskable-512.png', size: 512, full: true },
  { file: 'apple-touch-icon.png', size: 180, full: true },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const { file, size, full } of icons) {
  await page.setViewportSize({ width: size, height: size });
  const body = full
    ? `<div style="width:${size}px;height:${size}px;background:#196862;display:grid;place-items:center">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size * 0.82}" height="${size * 0.82}">${glyph.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
       </div>`
    : svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${body}</body></html>`,
  );
  await page.screenshot({ path: resolve(root, 'public/icons', file), omitBackground: !full });
}
await browser.close();
