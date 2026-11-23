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
    const key = 'relaacja.device.v1';
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

/** Home board 4×6 (rows × columns) with "a" at (0, 0), "b" at (0, 1) and "c" at (1, 0). */
async function seed(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Relaacja': '1' };
    const post = (path: string, body: unknown) =>
      fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
    const home = await post('/api/boards/home', { name: 'Start', rows: 4, cols: 6 });
    let board = home.boards[0];
    for (const [label, row, col] of [
      ['a', 0, 0],
      ['b', 0, 1],
      ['c', 1, 0],
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
    await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 3, kolumna 1' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Etykieta').fill('jabłko');
    await form.getByTestId('symbol-results').getByRole('button').first().click();
    await form.getByRole('button', { name: 'Zapisz' }).click();
    await expect(form).toHaveCount(0);
    expect(await storedTiles(page)).toEqual(['a@0,0', 'b@0,1', 'c@1,0', 'jabłko@0,2']);
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
