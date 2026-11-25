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
    let printed = 0;
    Object.defineProperty(window, 'print', {
      value: () => {
        printed++;
      },
      configurable: true,
    });
    Object.defineProperty(window, '__printCalls', {
      get: () => printed,
    });
  });
});

async function seedGrid(
  page: Page,
  rows: number,
  cols: number,
  tiles: [
    label: string,
    row: number,
    col: number,
    opts?: { hidden?: boolean; arasaac?: boolean },
  ][],
): Promise<void> {
  const ok = await page.evaluate(
    async ({ rows, cols, tiles }) => {
      const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
      const post = (path: string, body: unknown) =>
        fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
      const home = await post('/api/boards/home', { rows, cols });
      let board = home.boards[0];
      for (const [label, row, col, opts] of tiles) {
        const changes = await post(`/api/boards/${board.id}/tiles`, {
          rev: board.rev,
          row,
          col,
          kind: 'word',
          label,
          hidden: opts?.hidden ?? false,
          ...(opts?.arasaac ? { symbol: { set: 'arasaac', ref: '2462' } } : {}),
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

/** Reads PDF page MediaBoxes from Chromium's PDF output (no external PDF parser needed). */
function pdfPageSizes(pdf: Buffer): { width: number; height: number }[] {
  const text = pdf.toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  return boxes.map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
}

test('prints the displayed board with auto orientation, manual override, and print-media check', async ({
  page,
}) => {
  await freshLogin(page, 'Druk tablicy');
  await seedGrid(page, 4, 6, [
    ['jabłko', 0, 1, { arasaac: true }],
    ['tajne', 0, 2, { hidden: true }],
  ]);

  // Communication mode supports direct Ctrl+P via background .board-sheet (landscape for 4x6).
  await page.emulateMedia({ media: 'print' });
  const commSheet = page.locator('.board-sheet');
  await expect(commSheet).toBeVisible();
  await expect(commSheet).toHaveAttribute('data-orientation', 'landscape');
  await expect(commSheet).toContainText('Pulpit');
  await expect(commSheet).toContainText('jabłko');
  await expect(commSheet).not.toContainText('tajne');
  await expect(commSheet).toContainText('Symbole: Sergio Palao, ARASAAC (arasaac.org)');
  await expect(page.getByTestId('sentence')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(commSheet).toBeHidden();

  // Edit mode: open PrintBoardDialog, verify auto orientation (landscape for 4x6), axe, override.
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Drukuj', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Drukuj tablicę „Pulpit”' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Poziomo (zalecana)' })).toBeChecked();
  await expect(dialog.getByTestId('board-print-preview')).toHaveAttribute(
    'data-orientation',
    'landscape',
  );
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);

  // Hidden tiles excluded until toggled on.
  await expect(dialog.getByTestId('board-print-preview')).not.toContainText('tajne');
  await dialog.getByLabel('Pokaż ukryte kafelki').check();
  await expect(dialog.getByTestId('board-print-preview')).toContainText('tajne');

  // Switch manually to portrait and verify PDF dimensions + single page output on desktop.
  await dialog.getByText('Pionowo', { exact: true }).click();
  await expect(dialog.getByTestId('board-print-preview')).toHaveAttribute(
    'data-orientation',
    'portrait',
  );
  await expect(commSheet).toHaveAttribute('data-orientation', 'portrait');

  if (test.info().project.name === 'desktop') {
    const portraitPdf = pdfPageSizes(await page.pdf({ preferCSSPageSize: true }));
    expect(portraitPdf).toHaveLength(1);
    expect(portraitPdf[0]!.height).toBeGreaterThan(portraitPdf[0]!.width);

    await dialog.getByText('Poziomo (zalecana)', { exact: true }).click();
    const landscapePdf = pdfPageSizes(await page.pdf({ preferCSSPageSize: true }));
    expect(landscapePdf).toHaveLength(1);
    expect(landscapePdf[0]!.width).toBeGreaterThan(landscapePdf[0]!.height);
  }

  await dialog.getByRole('button', { name: 'Drukuj' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls))
    .toBe(1);
  await dialog.getByRole('button', { name: 'Anuluj' }).click();

  // Change grid to 6x4 (tall): auto orientation switches to portrait.
  await page.getByRole('button', { name: 'Siatka', exact: true }).click();
  const gridDialog = page.getByRole('dialog');
  await gridDialog.getByLabel('Wiersze').selectOption('6');
  await gridDialog.getByLabel('Kolumny').selectOption('4');
  await gridDialog.getByRole('button', { name: 'Zapisz' }).click();
  await expect(gridDialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Drukuj', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Pionowo (zalecana)' })).toBeChecked();
  await expect(dialog.getByTestId('board-print-preview')).toHaveAttribute(
    'data-orientation',
    'portrait',
  );
});

test('splits tall boards into pages and fits on one page when requested', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one browser is enough for paging PDF test');
  await freshLogin(page, 'Druk stron');
  await seedGrid(page, 8, 4, [
    ['góra', 0, 1],
    ['dół', 7, 3],
  ]);

  await holdEditLock(page);
  await page.getByRole('button', { name: 'Drukuj', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Drukuj tablicę „Pulpit”' });
  await expect(dialog.getByRole('radio', { name: 'Pionowo (zalecana)' })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: 'Automatyczny (2 str.)' })).toBeChecked();
  await expect(dialog.getByTestId('board-print-preview').locator('section')).toHaveCount(2);

  const twoPagePdf = pdfPageSizes(await page.pdf({ preferCSSPageSize: true }));
  expect(twoPagePdf).toHaveLength(2);
  expect(twoPagePdf[0]!.height).toBeGreaterThan(twoPagePdf[0]!.width);

  await dialog.getByText('Zmieść na 1 stronie', { exact: true }).click();
  await expect(dialog.getByTestId('board-print-preview').locator('section')).toHaveCount(1);
  const onePagePdf = pdfPageSizes(await page.pdf({ preferCSSPageSize: true }));
  expect(onePagePdf).toHaveLength(1);
});

test('board printing stays independent of phone fitGrid transposition', async ({ page }) => {
  test.skip(test.info().project.name === 'desktop', 'phone viewport check');
  await page.setViewportSize({ width: 412, height: 839 });
  await freshLogin(page, 'Druk telefon');
  await seedGrid(page, 4, 6, [['jabłko', 0, 1]]);

  // Even when the screen transposes 4x6, printing picks landscape for canonical 4x6.
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Drukuj', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Drukuj tablicę „Pulpit”' });
  await expect(dialog.getByRole('radio', { name: 'Poziomo (zalecana)' })).toBeChecked();
});
