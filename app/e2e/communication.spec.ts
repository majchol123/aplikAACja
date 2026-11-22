import AxeBuilder from '@axe-core/playwright';
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
  // The test taps faster than the default repeat guard allows.
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

const tile = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const sentence = (page: Page) => page.getByTestId('sentence-item');
const current = (page: Page) => page.getByTestId('current-board');

async function starterBoard(page: Page, name: string) {
  await freshLogin(page, name);
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(current(page)).toHaveText('Start');
}

test('a sentence built through a folder is spoken (PLAN F2)', async ({ page }) => {
  await starterBoard(page, 'Zdanie');
  // PLAN §2.7: 9 words and 8 folders, the rest left for the parent.
  await expect(page.getByTestId('board-grid').getByRole('button')).toHaveCount(17);
  await expect(tile(page, 'chcę').locator('img')).toHaveAttribute(
    'src',
    '/sym/arasaac/p/5441.0000abcd.webp',
  );

  await tile(page, 'chcę').click();
  await expect(sentence(page)).toHaveText(['chcę']);
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'chcę', voice: 'Zosia', pitch: 1 });

  await tile(page, 'Picie, folder').click();
  await expect(current(page)).toHaveText('Picie');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Start' })).toBeVisible();
  await tile(page, 'sok').click();
  await expect(sentence(page)).toHaveText(['chcę', 'sok']);
  // Back on the home board after a word (default "return to home").
  await expect(current(page)).toHaveText('Start');

  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  expect((await spoken(page)).at(-1)?.text).toBe('chcę sok');
  await page.getByTestId('sentence').click();
  expect((await spoken(page)).at(-1)?.text).toBe('chcę sok');

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('button', { name: 'Usuń ostatnie słowo' }).click();
  await expect(sentence(page)).toHaveText(['chcę']);
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();
  await expect(sentence(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Powiedz zdanie' })).toBeDisabled();
});

test('sliding off a tile does not activate it', async ({ page }) => {
  await starterBoard(page, 'Przesuniecie');
  const from = (await tile(page, 'ja').boundingBox())!;
  const to = (await tile(page, 'ty').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(sentence(page)).toHaveCount(0);
  // Lifting just past the edge (within 12 px) still counts.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width + 8, from.y + from.height / 2, { steps: 3 });
  await page.mouse.up();
  await expect(sentence(page)).toHaveText(['ja']);
  await tile(page, 'ty').click();
  await expect(sentence(page)).toHaveText(['ja', 'ty']);
});

test('edit mode needs a 2-second hold; settings keep device and account values', async ({
  page,
}) => {
  await starterBoard(page, 'Ustawienia');
  await page.getByRole('button', { name: /Tryb edycji/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Przytrzymaj 2 sekundy' })).toBeVisible();
  await expect(page.getByTestId('board-grid')).toBeVisible();

  await holdEditLock(page);
  await expect(page.getByRole('heading', { name: 'Tryb edycji' })).toBeVisible();
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Voice preset of this device.
  await page.getByLabel('Rodzaj głosu').selectOption('man');
  await page.getByRole('button', { name: 'Test głosu' }).click();
  expect((await spoken(page)).at(-1)).toMatchObject({ voice: 'Krzysztof' });
  // Account-wide: stay in the folder after a word; capital letters.
  await page.getByRole('checkbox', { name: /wracaj na pulpit/ }).uncheck();
  await page.getByRole('checkbox', { name: 'Etykiety wielkimi literami' }).check();
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();

  await tile(page, 'Jedzenie, folder').click();
  await tile(page, 'Śniadanie, folder').click();
  await expect(page.getByRole('navigation')).toContainText('Start›Jedzenie›Śniadanie');
  await tile(page, 'chleb').click();
  await expect(current(page)).toHaveText('Śniadanie');
  await expect(tile(page, 'chleb').locator('.tile-label')).toHaveCSS('text-transform', 'uppercase');
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'chleb', voice: 'Krzysztof' });
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(current(page)).toHaveText('Jedzenie');

  // Account settings survive a reload (they live on the server).
  await page.reload();
  await tile(page, 'Uczucia, folder').click();
  await tile(page, 'wesoły').click();
  await expect(current(page)).toHaveText('Uczucia');
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'wesoły', voice: 'Krzysztof' });
  await page.getByRole('button', { name: 'Pulpit' }).click();
  await expect(current(page)).toHaveText('Start');
});
