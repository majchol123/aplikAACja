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
  // The mirror's grammar file is the real PoliMorf for the starter template's words.
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

const tile = (page: Page, name: string) =>
  page.getByTestId('board-grid').getByRole('button', { name, exact: true });
const sentence = (page: Page) => page.getByTestId('sentence-item');
const lastSpoken = async (page: Page) => (await spoken(page)).at(-1)?.text;

async function starterBoard(page: Page, name: string): Promise<void> {
  await freshLogin(page, name);
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(page.getByTestId('current-board')).toHaveText('Pulpit');
}

async function word(page: Page, folder: string, label: string): Promise<void> {
  await tile(page, `${folder}, folder`).click();
  await tile(page, label).click();
}

test('the verb agrees with the subject, "ja" by default (F8)', async ({ page }) => {
  await starterBoard(page, 'Odmiana');
  await word(page, 'Zabawa', 'rysować');
  await expect(sentence(page)).toHaveText(['rysuję']);
  expect(await lastSpoken(page)).toBe('rysuję');
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  await tile(page, 'ty').click();
  await tile(page, 'chcę').click();
  await expect(sentence(page)).toHaveText(['ty', 'chcesz']);
  // Said in its form in the sentence the moment it is tapped.
  expect(await lastSpoken(page)).toBe('chcesz');
  await word(page, 'Zabawa', 'rysować');
  await expect(sentence(page)).toHaveText(['ty', 'chcesz', 'rysować']);
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  expect(await lastSpoken(page)).toBe('ty chcesz rysować');
  await expect(page.getByRole('group', { name: 'Zdanie: ty chcesz rysować' })).toBeVisible();
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  await word(page, 'Osoby', 'mama');
  await tile(page, 'nie chcę').click();
  await expect(sentence(page)).toHaveText(['mama', 'nie chce']);
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  // "boli" is said as it is, whoever comes before it.
  await tile(page, 'ty').click();
  await word(page, 'Ciało', 'boli');
  await expect(sentence(page)).toHaveText(['ty', 'boli']);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test('a word held in the bar offers its forms; the one picked is said and stays', async ({
  page,
}) => {
  await starterBoard(page, 'Formy');
  await tile(page, 'chcę').click();
  const said = (await spoken(page)).length;

  // A long press, as with a finger.
  const box = (await sentence(page).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Wybierz formę: chcę' });
  await expect(dialog).toBeVisible();
  // The hold did not speak the sentence.
  expect((await spoken(page)).length).toBe(said);
  await expect(dialog.getByRole('region', { name: 'Teraz' })).toContainText('chcesz');
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);

  await dialog.getByRole('button', { name: /^chciałam/ }).click();
  await expect(dialog).toBeHidden();
  await expect(sentence(page)).toHaveText(['chciałam']);
  expect(await lastSpoken(page)).toBe('chciałam');
  // A picked form is the user's: the grammar leaves it alone.
  await tile(page, 'pomocy').click();
  await expect(sentence(page)).toHaveText(['chciałam', 'pomocy']);
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  expect(await lastSpoken(page)).toBe('chciałam pomocy');

  // The context menu (right click, the menu key) opens the forms too; back to automatic.
  await sentence(page).first().click({ button: 'right' });
  await dialog.getByRole('button', { name: /Automatycznie/ }).click();
  await expect(sentence(page)).toHaveText(['chcę', 'pomocy']);
});

test('how the user speaks of themselves is asked at the first run (F8)', async ({ page }) => {
  await freshLogin(page, 'Rodzaj');
  const girl = page.getByRole('radio', { name: /Jak dziewczynka lub kobieta/ });
  await girl.check();
  await expect(girl).toBeChecked();
  await expect(page.getByRole('radio', { name: /Jak dziewczynka lub kobieta/ })).toBeEnabled();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(page.getByTestId('current-board')).toHaveText('Pulpit');

  await word(page, 'Uczucia', 'zmęczony');
  await expect(sentence(page)).toHaveText(['zmęczona']);

  // In the settings: the same choice, and the grammar can be switched off.
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(page.getByRole('radio', { name: /Jak dziewczynka lub kobieta/ })).toBeChecked();
  const level = page.getByLabel('Odmiana w zdaniu');
  await expect(level).toHaveValue('verbs');
  await level.selectOption('off');
  await expect(level).toBeEnabled();
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await word(page, 'Uczucia', 'zmęczony');
  await expect(sentence(page)).toHaveText(['zmęczony']);
});
