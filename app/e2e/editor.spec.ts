import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  mockSpeech,
  spoken,
} from './support.ts';

// Refused edits (grid too small) are part of the scenarios.
failOnConsoleErrors({ expected: [422] });

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

const current = (page: Page) => page.getByTestId('current-board');
const editTile = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^Zmień kafelek: ${label}( \\(folder\\))?$`) });
const dialog = (page: Page) => page.getByRole('dialog');

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
}

async function startEditing(page: Page, name: string, board: 'Tablica startowa' | 'Pusta tablica') {
  await freshLogin(page, name);
  await page.getByRole('button', { name: new RegExp(board) }).click();
  await expect(current(page)).toHaveText('Start');
  await holdEditLock(page);
  await expect(page.getByRole('heading', { name: 'Tryb edycji' })).toBeVisible();
}

/** Fills the new-tile dialog: label, kind, first matching symbol (or the n-th). */
async function addTile(
  page: Page,
  cell: string,
  label: string,
  { folder = false, variant = 0 }: { folder?: boolean; variant?: number } = {},
) {
  await page.getByRole('button', { name: `Dodaj kafelek: ${cell}` }).click();
  const form = dialog(page);
  await expect(form.getByRole('heading', { name: 'Nowy kafelek' })).toBeVisible();
  await form.getByLabel('Etykieta').fill(label);
  if (folder) await form.getByText('Folder (otwiera tablicę)').click();
  await form.getByTestId('symbol-results').getByRole('button').nth(variant).click();
  await form.getByRole('button', { name: 'Zapisz' }).click();
  await expect(form).toHaveCount(0);
}

async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test('Jedzenie → Śniadanie → chleb built from an empty board, then spoken (PLAN F2)', async ({
  page,
}) => {
  await startEditing(page, 'Edytor', 'Pusta tablica');
  await axe(page);

  await addTile(page, 'wiersz 1, kolumna 1', 'Jedzenie', { folder: true });
  await page.getByRole('button', { name: 'Otwórz folder Jedzenie' }).click();
  await expect(current(page)).toHaveText('Jedzenie');

  await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 1, kolumna 2' }).click();
  await axe(page);
  await dialog(page).getByRole('button', { name: 'Anuluj' }).click();
  await addTile(page, 'wiersz 1, kolumna 2', 'Śniadanie', { folder: true });
  await page.getByRole('button', { name: 'Otwórz folder Śniadanie' }).click();
  await expect(page.getByRole('navigation')).toContainText('Start›Jedzenie›Śniadanie');
  await addTile(page, 'wiersz 2, kolumna 3', 'chleb');
  await expect(editTile(page, 'chleb').locator('img')).toHaveAttribute('src', /\.webp$/);

  // Communication starts where editing ended; the new tree works like any other.
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(current(page)).toHaveText('Śniadanie');
  await page.getByRole('button', { name: 'Pulpit' }).click();
  await page.getByRole('button', { name: 'Jedzenie, folder' }).click();
  await page.getByRole('button', { name: 'Śniadanie, folder' }).click();
  await page.getByRole('button', { name: 'chleb', exact: true }).click();
  await expect(page.getByTestId('sentence-item')).toHaveText(['chleb']);
  await expect(current(page)).toHaveText('Start');
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  expect((await spoken(page)).at(-1)?.text).toBe('chleb');

  // Saved on the server, not just in this tab.
  await page.reload();
  await page.getByRole('button', { name: 'Jedzenie, folder' }).click();
  await expect(page.getByRole('button', { name: 'Śniadanie, folder' })).toBeVisible();
});

test('tiles are dragged, restyled, and the chosen variant of a word is remembered', async ({
  page,
}) => {
  await startEditing(page, 'Przeciaganie', 'Tablica startowa');
  const grid = page.getByTestId('edit-grid');
  const labels = () => grid.locator('.tile-cell').locator('.tile-label');

  // Drop on a tile: the two swap places.
  await drag(page, editTile(page, 'ja'), editTile(page, 'ty'));
  await expect(labels().nth(0)).toHaveText('ty');
  await expect(labels().nth(1)).toHaveText('ja');
  // Drop on an empty cell: the tile moves there (the last cell of the 4 × 6 home is free).
  await drag(
    page,
    editTile(page, 'tak'),
    page.getByRole('button', { name: /wiersz 4, kolumna 6$/ }),
  );
  await expect(grid.locator('.tile-cell').nth(23)).toContainText('tak');

  await editTile(page, 'nie').click();
  const form = dialog(page);
  await form.getByText('XL', { exact: true }).click();
  await form.getByText('Nad obrazkiem').click();
  await form.getByText('Tło', { exact: true }).click();
  await form.getByText('Przeczenia').click();
  await form.getByRole('button', { name: 'Zapisz' }).click();
  await expect(form).toHaveCount(0);
  const nie = editTile(page, 'nie');
  await expect(nie).toHaveClass(/tile-filled/);
  await expect(nie).toHaveClass(/bg-red-200/);
  await expect(nie.locator('.tile-label')).toHaveClass(/tile-label-xl/);
  await expect(nie.locator(':first-child')).toHaveClass(/tile-label/);

  // Two symbols match "nos": pick the second one, it comes first (starred) next time.
  await addTile(page, 'wiersz 2, kolumna 4', 'nos', { variant: 1 });
  await page.getByRole('button', { name: 'Dodaj kafelek: wiersz 2, kolumna 5' }).click();
  await dialog(page).getByLabel('Etykieta').fill('nos');
  const first = dialog(page).getByTestId('symbol-results').getByRole('button').first();
  await expect(first).toHaveAccessibleName(/nr 30000\), ulubiony wariant$/);
  await dialog(page).getByRole('button', { name: 'Anuluj' }).click();

  // Everything above is stored on the server.
  await page.reload();
  const comm = page.getByTestId('board-grid').locator('.tile-label');
  await expect(comm.nth(0)).toHaveText('ty');
  await expect(comm.nth(1)).toHaveText('ja');
  await expect(page.getByRole('button', { name: 'nie', exact: true })).toHaveClass(/bg-red-200/);
});

test('PIN, grid size, moving between boards and deleting', async ({ page }) => {
  await startEditing(page, 'Pin', 'Tablica startowa');

  // PIN of this device.
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: 'Ustaw PIN' }).click();
  await page.getByLabel('Nowy PIN (4 cyfry)').fill('1234');
  await page.getByLabel('Powtórz PIN').fill('1234');
  await page.getByRole('button', { name: 'Zapisz PIN' }).click();
  await expect(page.getByTestId('pin-state')).toHaveText('PIN jest ustawiony.');
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await holdEditLock(page);
  const pad = dialog(page);
  await expect(pad.getByRole('heading', { name: 'Podaj PIN' })).toBeVisible();
  await axe(page);
  for (const digit of '1111') await pad.getByRole('button', { name: digit, exact: true }).click();
  await expect(pad.getByRole('alert')).toHaveText('Nieprawidłowy PIN.');
  for (const digit of '1234') await pad.getByRole('button', { name: digit, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tryb edycji' })).toBeVisible();

  // Shrinking the grid under existing tiles is refused with an explanation.
  await page.getByRole('button', { name: 'Nazwa i siatka' }).click();
  await dialog(page).getByLabel('Wiersze').selectOption('2');
  await dialog(page).getByRole('button', { name: 'Zapisz' }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('nie zmieści się');
  await dialog(page).getByLabel('Wiersze').selectOption('4');
  await dialog(page).getByLabel('Nazwa').fill('Mój pulpit');
  await dialog(page).getByRole('button', { name: 'Zapisz' }).click();
  await expect(current(page)).toHaveText('Mój pulpit');

  // Moving a tile into a folder (the keyboard-friendly way, no dragging).
  await editTile(page, 'pomocy').click();
  await dialog(page).getByRole('button', { name: 'Przenieś…' }).click();
  await dialog(page).getByLabel('Tablica').selectOption({ label: 'Mój pulpit › Osoby' });
  await dialog(page)
    .getByRole('button', { name: /: puste$/ })
    .first()
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(editTile(page, 'pomocy')).toHaveCount(0);
  await page.getByRole('button', { name: 'Otwórz folder Osoby' }).click();
  await expect(editTile(page, 'pomocy')).toBeVisible();
  await page.getByRole('button', { name: 'Pulpit', exact: true }).click();

  // Deleting a folder says what goes with it.
  await editTile(page, 'Picie').click();
  await dialog(page).getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(dialog(page)).toContainText('zniknie jego zawartość: 1 tablica i');
  await dialog(page).getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(editTile(page, 'Picie')).toHaveCount(0);
});
