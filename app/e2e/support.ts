import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** CSP violations and runtime errors surface as console errors: fail on any of them. */
export function failOnConsoleErrors(): void {
  const errors = new WeakMap<Page, string[]>();
  test.beforeEach(({ page }) => {
    const list: string[] = [];
    errors.set(page, list);
    page.on('console', (msg) => {
      // Expected auth/CSRF rejections (401/403) are logged by the browser too.
      if (msg.type() === 'error' && !/status of 40[13]/.test(msg.text())) list.push(msg.text());
    });
    page.on('pageerror', (err) => list.push(err.message));
  });
  test.afterEach(({ page }) => {
    expect(errors.get(page) ?? []).toEqual([]);
  });
}

export async function devLogin(page: Page, who: { sub: string; email: string; name: string }) {
  await page.goto('/');
  const status = await page.evaluate(async (body) => {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relaacja': '1' },
      body: JSON.stringify(body),
    });
    return res.status;
  }, who);
  expect(status).toBe(204);
  await page.goto('/');
}

/** A fresh account per test run and project (tests change saved state). */
export async function freshLogin(page: Page, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const sub = `e2e-${slug}-${test.info().project.name}-${Date.now()}`;
  await devLogin(page, { sub, email: `${sub}@example.com`, name });
}

const ROOT = resolve(import.meta.dirname, '../..');
const VECTORS = resolve(ROOT, 'packages/shared/test-vectors');
export const TINY_WEBP = Buffer.from('UklGRhwAAABXRUJQVlA4TBAAAAAvB8ABAAdQwP5H/wMR0f8A', 'base64');

interface TemplateTile {
  label: string;
  symbol?: { ref: string };
  board?: { tiles: TemplateTile[] };
}

/** Index items for every pictogram of the starter template, so its tiles get images. */
function starterItems(): { id: number; f: string; k: string[]; r: string }[] {
  const template = JSON.parse(readFileSync(resolve(ROOT, 'templates/starter.json'), 'utf8')) as {
    board: { tiles: TemplateTile[] };
  };
  const out = new Map<number, { id: number; f: string; k: string[]; r: string }>();
  const walk = (tiles: TemplateTile[]) => {
    for (const t of tiles) {
      if (t.symbol) {
        const id = Number(t.symbol.ref);
        out.set(id, { id, f: `p/${id}.0000abcd.webp`, k: [t.label], r: 'misc' });
      }
      if (t.board) walk(t.board.tiles);
    }
  };
  walk(template.board.tiles);
  return [...out.values()];
}

/** The ARASAAC mirror is a separate Worker in production; here the shared vectors stand in. */
export async function mockArasaac(page: Page, { withStarter = false } = {}) {
  const vectors = JSON.parse(readFileSync(resolve(VECTORS, 'sample-index.json'), 'utf8')) as {
    items: { id: number }[];
  };
  const known = new Set(vectors.items.map((i) => i.id));
  const index = withStarter
    ? { ...vectors, items: [...vectors.items, ...starterItems().filter((i) => !known.has(i.id))] }
    : vectors;
  const forms = readFileSync(resolve(VECTORS, 'sample-forms.json'));
  const manifest = {
    v: 1,
    set: 'arasaac',
    name: 'ARASAAC',
    index: 'index.00000000.json',
    forms: 'forms.00000000.json',
    count: index.items.length,
  };
  await page.route('**/sym/arasaac/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
    if (path.endsWith('/index.00000000.json')) return route.fulfill({ json: index });
    if (path.endsWith('/forms.00000000.json'))
      return route.fulfill({ body: forms, contentType: 'application/json' });
    if (path.endsWith('.webp'))
      return route.fulfill({ body: TINY_WEBP, contentType: 'image/webp' });
    return route.fulfill({ status: 404 });
  });
}

/**
 * Replaces speechSynthesis with a recorder (PLAN §7): window.__spoken lists every
 * utterance with the voice settings it was given.
 */
export async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    type Spoken = { text: string; lang: string; voice: string | null; pitch: number };
    const spoken: Spoken[] = [];
    const voices = [
      { name: 'Zosia', lang: 'pl-PL', voiceURI: 'Zosia', localService: true, default: false },
      {
        name: 'Krzysztof',
        lang: 'pl-PL',
        voiceURI: 'Krzysztof',
        localService: true,
        default: false,
      },
    ];
    class FakeUtterance {
      lang = '';
      pitch = 1;
      rate = 1;
      voice: { name: string } | null = null;
      constructor(readonly text: string) {}
    }
    const synth = {
      getVoices: () => voices,
      speak: (u: FakeUtterance) =>
        spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? null, pitch: u.pitch }),
      cancel: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(globalThis, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: FakeUtterance,
      configurable: true,
    });
    (globalThis as unknown as { __spoken: Spoken[] }).__spoken = spoken;
  });
}

export async function spoken(page: Page) {
  return page.evaluate(
    () =>
      (
        globalThis as unknown as {
          __spoken: { text: string; voice: string | null; pitch: number }[];
        }
      ).__spoken,
  );
}

/** Opens parent mode the way a parent does: holding the lock button for 2 seconds. */
export async function holdParentLock(page: Page) {
  const lock = page.getByRole('button', { name: /Tryb rodzica/ });
  const box = (await lock.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  await page.mouse.up();
}
