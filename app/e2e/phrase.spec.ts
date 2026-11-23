import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  mockSpeech,
  spoken,
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

const TEXT = 'Dzień dobry, Ola, pije sok jabłkowy';
const current = (page: Page) => page.getByTestId('current-board');
const cards = (page: Page) => page.getByTestId('phrase').getByRole('button');

async function emptyBoard(page: Page, name: string) {
  await freshLogin(page, name);
  await page.getByRole('button', { name: /Pusta tablica/ }).click();
  await expect(current(page)).toHaveText('Start');
}

async function setSetting(page: Page, patch: Record<string, unknown>) {
  const status = await page.evaluate(async (body) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' },
      body: JSON.stringify(body),
    });
    return res.status;
  }, patch);
  expect(status).toBe(200);
}

test('the phrase generator turns a sentence into symbols for the sentence bar (F5)', async ({
  page,
}) => {
  await emptyBoard(page, 'Generator fraz');
  await expect(page.getByRole('button', { name: 'Generator fraz' })).toBeHidden();
  await setSetting(page, { showPhraseGenerator: true });
  await page.reload();
  await page.getByRole('button', { name: 'Generator fraz' }).click();
  const generator = page.getByRole('dialog', { name: 'Generator fraz' });
  await generator.getByLabel('Napisz zdanie albo słowa').fill(TEXT);
  await expect(page.getByTestId('phrase').getByRole('listitem')).toHaveText([
    'Dzień dobry',
    'Ola',
    'pije',
    'sok jabłkowy',
  ]);
  await expect(cards(page).nth(2)).toHaveAccessibleName('pije: zmień symbol');
  await expect(cards(page).locator('img')).toHaveCount(4);
  await expect(generator).toContainText('Symbole: Sergio Palao, ARASAAC (arasaac.org)');
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);

  // Labels from the names of the symbols; one word without a symbol.
  await generator.getByLabel(/Napisy z nazw symboli/).check();
  await expect(cards(page).nth(2)).toHaveAccessibleName('pić: zmień symbol');
  await generator.getByLabel(/Napisy z nazw symboli/).uncheck();
  await cards(page).nth(1).click();
  const slot = page.getByRole('dialog', { name: 'Symbol dla „Ola”' });
  await slot.getByRole('button', { name: 'Bez symbolu' }).click();
  await expect(slot).toBeHidden();
  await expect(cards(page).locator('img')).toHaveCount(3);
  // ...and back, through the picker, which starts with the word itself.
  await cards(page).nth(1).click();
  await expect(slot.getByLabel('Szukaj symbolu')).toHaveValue('Ola');
  await slot.getByRole('button', { name: /^Ola, ARASAAC, nr 7001/ }).click();
  await expect(slot).toBeHidden();
  await expect(cards(page).locator('img')).toHaveCount(4);
  // Another symbol of the library for "pije".
  await cards(page).nth(2).click();
  const drink = page.getByRole('dialog', { name: 'Symbol dla „pije”' });
  await drink.getByLabel('Szukaj symbolu').fill('jabłko');
  await drink.getByRole('button', { name: /^jabłko, ARASAAC, nr 2462/ }).click();
  await expect(cards(page).nth(2).locator('img')).toHaveAttribute('src', /\/2462\./);
  await expect(cards(page).nth(2)).toHaveAccessibleName('pije: zmień symbol');

  await generator.getByRole('button', { name: 'Odczytaj' }).click();
  await expect
    .poll(async () => (await spoken(page)).at(-1)?.text)
    .toBe('Dzień dobry Ola pije sok jabłkowy');
  await generator.getByRole('button', { name: 'Do paska zdaniowego' }).click();
  await expect(generator).toBeHidden();
  await expect(page.getByTestId('sentence-item')).toHaveText([
    'Dzień dobry',
    'Ola',
    'pije',
    'sok jabłkowy',
  ]);
});

test('a generated phrase is saved as a board, a PNG, a favourite and printed (F5)', async ({
  page,
}) => {
  await emptyBoard(page, 'Fraza jako tablica');
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Generator fraz' }).click();
  const generator = page.getByRole('dialog', { name: 'Generator fraz' });
  await generator.getByLabel('Napisz zdanie albo słowa').fill(TEXT);
  await expect(cards(page)).toHaveCount(4);
  await expect(generator.getByRole('button', { name: 'Do paska zdaniowego' })).toBeHidden();

  const saving = page.waitForEvent('download');
  await generator.getByRole('button', { name: 'Zapisz obraz PNG' }).click();
  const file = await saving;
  expect(file.suggestedFilename()).toBe('fraza.png');
  const png = await readFile(await file.path());
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  await page.emulateMedia({ media: 'print' });
  await expect(generator).toBeHidden();
  const sheet = page.locator('.phrase-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('li')).toHaveText(['Dzień dobry', 'Ola', 'pije', 'sok jabłkowy']);
  await expect(sheet).toContainText('Symbole: Sergio Palao, ARASAAC (arasaac.org)');
  await page.emulateMedia({ media: 'screen' });
  await expect(sheet).toBeHidden();

  await generator.getByRole('button', { name: 'Do ulubionych' }).click();
  await expect(generator.getByRole('status')).toHaveText('Zapisano w ulubionych.');
  await generator.getByRole('button', { name: 'Zapisz jako tablicę' }).click();
  await expect(generator.getByRole('status')).toHaveText(
    'Dodano tablicę „Dzień dobry Ola pije sok jabłkowy” na tablicy „Start”.',
  );
  await generator.getByRole('button', { name: 'Zamknij' }).click();
  await expect(
    page.getByRole('button', { name: 'Zmień kafelek: Dzień dobry Ola pije sok jabłkowy (folder)' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Gotowe' }).click();
  await page
    .getByRole('button', { name: 'Dzień dobry Ola pije sok jabłkowy, folder', exact: true })
    .click();
  await expect(current(page)).toHaveText('Dzień dobry Ola pije sok jabłkowy');
  for (const word of ['Dzień dobry', 'Ola', 'pije', 'sok jabłkowy']) {
    await expect(page.getByRole('button', { name: word, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  await expect(
    page.getByRole('button', { name: 'Usuń z ulubionych: Dzień dobry Ola pije sok jabłkowy' }),
  ).toBeVisible();
});
