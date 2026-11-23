import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  mockSpeech,
} from './support.ts';

failOnConsoleErrors();

test.beforeEach(async ({ page }) => {
  await mockArasaac(page, { withStarter: true });
  await mockSpeech(page);
  await page.addInitScript(() => {
    const key = 'aplikaacja.device.v1';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({
          motor: { activateOn: 'release', minHoldMs: 0, sameTileGuardMs: 0, globalGuardMs: 0 },
        }),
      );
    }
  });
});

const grid = (page: Page) => page.getByTestId('board-grid');
const tile = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });

/**
 * Home board 4×6 (rows × columns) with "a" at (0, 1), "b" at (0, 2) and "c" at (1, 1); its
 * first cell is "Wszystkie symbole".
 */
async function seed(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
    const post = (path: string, body: unknown) =>
      fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
    const home = await post('/api/boards/home', { name: 'Start', rows: 4, cols: 6 });
    let board = home.boards[0];
    for (const [label, row, col] of [
      ['a', 0, 1],
      ['b', 0, 2],
      ['c', 1, 1],
    ] as const) {
      const changes = await post(`/api/boards/${board.id}/tiles`, {
        rev: board.rev,
        row,
        col,
        kind: 'word',
        label,
      });
      board = changes.boards.find((b: { id: string }) => b.id === board.id);
    }
    return board.tiles.length === 3;
  });
  expect(ok).toBe(true);
  await page.reload();
}

async function boxes(page: Page) {
  const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((l) => tile(page, l).boundingBox()));
  if (!a || !b || !c) throw new Error('tiles not on screen');
  return { a, b, c };
}

async function storedTiles(page: Page) {
  return page.evaluate(async () => {
    const tree = await fetch('/api/boards').then((r) => r.json());
    return (tree.boards[0].tiles as { label: string; row: number; col: number }[])
      .map((t) => `${t.label}@${t.row},${t.col}`)
      .sort();
  });
}

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 412, height: 839 },
    screen: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });

  test('a 4×6 board turns into 6×4 in portrait; tiles keep their stored places', async ({
    page,
  }) => {
    test.skip(test.info().project.name === 'desktop', 'one phone run is enough');
    await freshLogin(page, 'Telefon');
    await seed(page);

    // Portrait: the first row became the first column, and the tiles grew.
    await expect(grid(page)).toHaveAttribute('data-transposed', 'true');
    const portrait = await boxes(page);
    let { a, b } = portrait;
    const { c } = portrait;
    expect(Math.abs(b.x - a.x)).toBeLessThan(2);
    expect(b.y).toBeGreaterThan(a.y + a.height / 2);
    expect(Math.abs(c.y - a.y)).toBeLessThan(2);
    expect(c.x).toBeGreaterThan(a.x + a.width / 2);
    expect(a.width).toBeGreaterThan(80);
    await tile(page, 'b').click();
    await expect(page.getByTestId('sentence-item')).toHaveText(['b']);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);

    // Landscape: the board as stored.
    await page.setViewportSize({ width: 839, height: 412 });
    await expect(grid(page)).not.toHaveAttribute('data-transposed');
    ({ a, b } = await boxes(page));
    expect(Math.abs(b.y - a.y)).toBeLessThan(2);
    expect(b.x).toBeGreaterThan(a.x + a.width / 2);
    await page.setViewportSize({ width: 412, height: 839 });
    await expect(grid(page)).toHaveAttribute('data-transposed', 'true');

    // Edit mode draws the same grid; places are named as seen, stored as before.
    await holdEditLock(page);
    await expect(
      page.getByRole('button', { name: 'Dodaj kafelek: wiersz 6, kolumna 4' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^Dodaj kafelek: wiersz \d, kolumna [56]$/ }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 4, kolumna 1' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Etykieta').fill('jabłko');
    await form.getByTestId('symbol-results').getByRole('button').first().click();
    await form.getByRole('button', { name: 'Zapisz' }).click();
    await expect(form).toHaveCount(0);
    expect(await storedTiles(page)).toEqual(['a@0,1', 'b@0,2', 'c@1,1', 'jabłko@0,3']);
    await page.getByRole('button', { name: 'Nazwa i siatka' }).click();
    await expect(page.getByRole('dialog')).toContainText('wiersze widać jako kolumny');
    await page.getByRole('button', { name: 'Anuluj' }).click();

    // On by default here; turned off, the grid is drawn as stored again.
    await page.getByRole('button', { name: 'Ustawienia' }).click();
    const fit = page.getByRole('checkbox', { name: 'Dopasuj siatkę do orientacji ekranu' });
    await expect(fit).toBeChecked();
    await fit.uncheck();
    await page.getByRole('button', { name: 'Wróć do edycji' }).click();
    await page.getByRole('button', { name: 'Gotowe' }).click();
    await expect(grid(page)).not.toHaveAttribute('data-transposed');
  });
});

test('tablets keep the grid as stored unless the setting is on', async ({ page }) => {
  test.skip(test.info().project.name !== 'tablet-android', 'a portrait tablet');
  await freshLogin(page, 'Tablet');
  await seed(page);
  await expect(grid(page)).not.toHaveAttribute('data-transposed');

  await holdEditLock(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  const fit = page.getByRole('checkbox', { name: 'Dopasuj siatkę do orientacji ekranu' });
  await expect(fit).not.toBeChecked();
  await fit.check();
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(grid(page)).toHaveAttribute('data-transposed', 'true');
  const { a, b } = await boxes(page);
  expect(b.y).toBeGreaterThan(a.y + a.height / 2);
});

/** Whether the whole element is inside the window (run in the page). */
const onScreen = (el: Element) => {
  const box = el.getBoundingClientRect();
  return box.top >= 0 && box.bottom <= window.innerHeight;
};

/** Home board of `rows` × `cols` with the given tiles, created through the API. */
async function seedGrid(
  page: Page,
  rows: number,
  cols: number,
  tiles: [label: string, row: number, col: number][],
): Promise<void> {
  const ok = await page.evaluate(
    async ({ rows, cols, tiles }) => {
      const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
      const post = (path: string, body: unknown) =>
        fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
      const home = await post('/api/boards/home', { name: 'Start', rows, cols });
      let board = home.boards[0];
      for (const [label, row, col] of tiles) {
        const changes = await post(`/api/boards/${board.id}/tiles`, {
          rev: board.rev,
          row,
          col,
          kind: 'word',
          label,
        });
        board = changes.boards.find((b: { id: string }) => b.id === board.id);
      }
      return board.tiles.length === tiles.length;
    },
    { rows, cols, tiles },
  );
  expect(ok).toBe(true);
  await page.reload();
}

test('a tall board scrolls down instead of shrinking its tiles', async ({ page }) => {
  test.skip(test.info().project.name !== 'tablet-android', 'a touch tablet');
  await freshLogin(page, 'Wysoka');
  await seedGrid(page, 30, 6, [
    ['pierwszy', 0, 1],
    ['ostatni', 29, 5],
  ]);
  const area = page.locator('.comm-root > .board-area');
  const first = (await tile(page, 'pierwszy').boundingBox())!;
  // Medium tiles (6rem) at the least, the label under the symbol, the rest further down.
  expect(first.height).toBeGreaterThanOrEqual(95);
  expect(first.width / first.height).toBeLessThan(1.65);
  await expect(tile(page, 'pierwszy')).toHaveCSS('flex-direction', 'column');
  await expect(tile(page, 'ostatni')).not.toBeInViewport();
  const { scrollHeight, clientHeight } = await area.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollHeight).toBeGreaterThan(clientHeight * 2);

  // A swipe up scrolls the board and says nothing (real touch events: the CDP scroll
  // gesture does not scroll in headless Chromium).
  const box = (await area.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const client = await page.context().newCDPSession(page);
  const scrolled = () => area.evaluate((el) => el.scrollTop);
  for (let i = 0; i < 15 && !(await tile(page, 'ostatni').evaluate(onScreen)); i++) {
    let y = Math.round(box.y + box.height * 0.8);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 0; step < 20; step++) {
      y -= Math.round((box.height * 0.6) / 20);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  expect(await scrolled()).toBeGreaterThan(clientHeight);
  await expect(tile(page, 'ostatni')).toBeInViewport();
  await expect(page.getByTestId('sentence-item')).toHaveCount(0);
  await tile(page, 'ostatni').click();
  await expect(page.getByTestId('sentence-item')).toHaveText(['ostatni']);

  // "Without scrolling" puts the whole board on one screen again, with small tiles.
  await page.evaluate(() => {
    const key = 'aplikaacja.device.v1';
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...stored, tileMin: 'fit' }));
  });
  await page.reload();
  await expect(tile(page, 'ostatni')).toBeInViewport();
  expect((await tile(page, 'pierwszy').boundingBox())!.height).toBeLessThan(40);
});

test('the editor scrolls a tall board too and offers 40 rows', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one run is enough');
  await freshLogin(page, 'Wysoka edycja');
  await seedGrid(page, 12, 4, [['pierwszy', 0, 1]]);
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Nazwa i siatka' }).click();
  const rows = page.getByRole('dialog').getByLabel('Wiersze');
  await expect(rows.locator('option')).toHaveCount(40);
  await rows.selectOption('40');
  await page.getByRole('dialog').getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const last = page.getByRole('button', { name: 'Dodaj kafelek: wiersz 40, kolumna 4' });
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Etykieta').fill('na dole');
  await form.getByRole('button', { name: 'Zapisz' }).click();
  await expect(form).toHaveCount(0);
  expect(await storedTiles(page)).toEqual(['na dole@39,3', 'pierwszy@0,1']);
});

test('in the editor a long press drags a tile and a swipe scrolls the board (touch)', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'tablet-android', 'a touch tablet');
  await freshLogin(page, 'Dotyk edycja');
  await seedGrid(page, 20, 4, [
    ['a', 0, 1],
    ['b', 0, 2],
  ]);
  await holdEditLock(page);
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
  const centre = async (label: string) => {
    const box = (await page
      .getByRole('button', { name: `Zmień kafelek: ${label}` })
      .boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // Held still for a moment, the tile follows the finger and swaps with the one it lands on.
  const a = await centre('a');
  const b = await centre('b');
  await touch('touchStart', a.x, a.y);
  await page.waitForTimeout(500);
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', a.x + ((b.x - a.x) * step) / 10, a.y + ((b.y - a.y) * step) / 10);
  }
  await touch('touchEnd', b.x, b.y);
  await expect.poll(() => storedTiles(page)).toEqual(['a@0,2', 'b@0,1']);

  // A quick swipe over a tile scrolls instead.
  const area = page.locator('.edit-root > .board-area');
  const start = await centre('b');
  await touch('touchStart', start.x, start.y);
  for (let step = 1; step <= 20; step++) await touch('touchMove', start.x, start.y - step * 15);
  await touch('touchEnd', start.x, start.y - 300);
  await expect.poll(() => area.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  expect(await storedTiles(page)).toEqual(['a@0,2', 'b@0,1']);
});
