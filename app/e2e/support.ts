import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CSP violations and runtime errors surface as console errors: fail on any of them.
 * Refusals the tests provoke on purpose (auth/CSRF 401/403, `expected`) are logged by the
 * browser too and are let through.
 */
export function failOnConsoleErrors({
  expected = [] as number[],
  offline = false, // requests the test sends with the network switched off
} = {}): void {
  const errors = new WeakMap<Page, string[]>();
  const codes = new RegExp(`status of (${[401, 403, ...expected].join('|')})\\b`);
  const allowed = offline ? new RegExp(`${codes.source}|net::ERR_INTERNET_DISCONNECTED`) : codes;
  test.beforeEach(({ page }) => {
    const list: string[] = [];
    errors.set(page, list);
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !allowed.test(msg.text())) list.push(msg.text());
    });
    page.on('pageerror', (err) => list.push(err.message));
  });
  test.afterEach(({ page }) => {
    expect(errors.get(page) ?? []).toEqual([]);
  });
}

export async function devLogin(page: Page, who: { sub: string; email: string; name: string }) {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  // From the test process (page.request shares the context's cookies), so a retried request
  // leaves no console error: promoteToAdmin in a parallel test (wrangler d1 execute --local)
  // can hold the local database for a moment, and the login fails with SQLITE_BUSY (500).
  let status = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await page.request.post('/api/auth/dev-login', {
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Aplikaacja': '1' },
      data: who,
    });
    status = res.status();
    if (status !== 500) break;
    await page.waitForTimeout(300 * (attempt + 1));
  }
  expect(status).toBe(204);
  await page.goto('/');
}

/** A fresh account per test run and project (tests change saved state). */
export async function freshLogin(page: Page, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Random part: repeated or parallel runs of one test may start in the same millisecond.
  const sub = `e2e-${slug}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await devLogin(page, { sub, email: `${sub}@example.com`, name });
  return sub;
}

/**
 * Gives an account created by freshLogin the stored role `admin` in the local D1 of the
 * preview server (superadmin comes from ADMIN_EMAILS, which differs between machines).
 */
export function promoteToAdmin(sub: string): void {
  updateTestAccount(sub, "role = 'admin'");
}

/** Moves the creation of a freshLogin account `days` back: an account with a past. */
export function backdateAccount(sub: string, days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error(`days: ${days}`);
  updateTestAccount(sub, `created_at = created_at - ${days * 24 * 3600 * 1000}`);
}

function updateTestAccount(sub: string, assignment: string): void {
  if (!/^e2e-[a-z0-9-]+$/.test(sub)) throw new Error(`not a test account: ${sub}`);
  const args = [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--command',
    `UPDATE users SET ${assignment} WHERE google_sub = 'dev:${sub}'`,
  ];
  // Both projects may write the local database at the same moment (SQLite busy): retry.
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('pnpm', args, { cwd: resolve(import.meta.dirname, '..'), stdio: 'ignore' });
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * attempt);
    }
  }
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
  const categories = readFileSync(resolve(VECTORS, 'sample-categories.json'));
  const manifest = {
    v: 1,
    set: 'arasaac',
    name: 'ARASAAC',
    index: 'index.00000000.json',
    forms: 'forms.00000000.json',
    categories: 'categories.00000000.json',
    count: index.items.length,
  };
  await page.route('**/sym/arasaac/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
    if (path.endsWith('/index.00000000.json')) return route.fulfill({ json: index });
    if (path.endsWith('/forms.00000000.json'))
      return route.fulfill({ body: forms, contentType: 'application/json' });
    if (path.endsWith('/categories.00000000.json'))
      return route.fulfill({ body: categories, contentType: 'application/json' });
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

/** Opens edit mode the way people do: holding the lock button for 2 seconds. */
export async function holdEditLock(page: Page) {
  const lock = page.getByRole('button', { name: /Tryb edycji/ });
  const box = (await lock.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  await page.mouse.up();
}
