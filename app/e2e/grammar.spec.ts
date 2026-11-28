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
  // Not an ARASAAC keyword: in the lexicon because the template has it.
  await word(page, 'Osoby', 'koleżanka');
  await tile(page, 'chcę').click();
  await expect(sentence(page)).toHaveText(['koleżanka', 'chce']);
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

  // A picked noun form ("sok" instead of automatic "soku") also stays fixed.
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();
  await tile(page, 'chcę').click();
  await word(page, 'Picie', 'sok');
  await expect(sentence(page)).toHaveText(['chcę', 'soku']);
  await sentence(page).nth(1).click({ button: 'right' });
  const sokDialog = page.getByRole('dialog', { name: 'Wybierz formę: sok' });
  await sokDialog
    .getByRole('button', { name: /^sok\b/ })
    .first()
    .click();
  await expect(sokDialog).toBeHidden();
  await expect(sentence(page)).toHaveText(['chcę', 'sok']);
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
  await expect(level).toHaveValue('full');
  await level.selectOption('off');
  await expect(level).toBeEnabled();
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await word(page, 'Uczucia', 'zmęczony');
  await expect(sentence(page)).toHaveText(['zmęczony']);
});

test('nouns take their cases by default; a word a later one changes flashes (F8 G2)', async ({
  page,
}) => {
  // "Pełna" is the default level.
  await starterBoard(page, 'Przypadki');

  // "chcieć" takes the genitive: the correct form, not the colloquial "chcę wodę".
  await tile(page, 'chcę').click();
  await word(page, 'Picie', 'woda');
  await expect(sentence(page)).toHaveText(['chcę', 'wody']);
  expect(await lastSpoken(page)).toBe('wody');
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  await tile(page, 'nie chcę').click();
  await word(page, 'Picie', 'mleko');
  await expect(sentence(page)).toHaveText(['nie chcę', 'mleka']);
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  // An adjective takes the gender of the noun after it — a change to an earlier word flashes.
  await word(page, 'Uczucia', 'zmęczony');
  await expect(sentence(page)).toHaveText(['zmęczony']);
  await word(page, 'Osoby', 'mama');
  await expect(sentence(page)).toHaveText(['zmęczona', 'mama']);
  const animations = await sentence(page)
    .first()
    .locator('span')
    .evaluate((el) => el.getAnimations().length);
  expect(animations).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  expect(await lastSpoken(page)).toBe('zmęczona mama');
});

test('an own word inflects like another one; the editor shows its forms (F8 G3)', async ({
  page,
}) => {
  await starterBoard(page, 'Własne słowo');
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Otwórz folder Zabawa' }).click();
  await page
    .getByRole('button', { name: /^Dodaj kafelek:/ })
    .first()
    .click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Etykieta').fill('hulajnoga');
  const grammar = form.getByRole('group', { name: 'Odmiana w zdaniu' });
  await expect(grammar).toContainText('Aplikacja nie zna słowa „hulajnoga”');
  await grammar.getByRole('button', { name: 'jak „noga”' }).click();
  await expect(grammar.getByRole('button', { name: 'jak „noga”' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(grammar).toContainText('hulajnogę');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await form.getByRole('button', { name: 'Zapisz' }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Gotowe' }).click();

  await page.getByRole('button', { name: 'Pulpit' }).click();
  await tile(page, 'chcę').click();
  await word(page, 'Zabawa', 'hulajnoga');
  await expect(sentence(page)).toHaveText(['chcę', 'hulajnogi']);

  // The editor keeps the choice; "Nie odmieniaj" makes the tile say its label.
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Otwórz folder Zabawa' }).click();
  await page.getByRole('button', { name: 'Zmień kafelek: hulajnoga' }).click();
  await expect(
    form
      .getByRole('group', { name: 'Odmiana w zdaniu' })
      .getByRole('button', { name: 'jak „noga”' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await form.getByLabel('Nie odmieniaj').check();
  await form.getByRole('button', { name: 'Zapisz' }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await page.getByRole('button', { name: 'Pulpit' }).click();
  await tile(page, 'chcę').click();
  await word(page, 'Zabawa', 'hulajnoga');
  await expect(sentence(page)).toHaveText(['chcę', 'hulajnoga']);
});

test('tiles may show the form their word takes in the sentence (F8 G4)', async ({ page }) => {
  await starterBoard(page, 'Podglad');
  // Off by default: labels stay as they are.
  await tile(page, 'ty').click();
  await expect(tile(page, 'chcę')).toBeVisible();
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();

  await holdEditLock(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByLabel(/Podpisy kafelków w formie/).check();
  await page.getByRole('button', { name: 'Wróć do edycji' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();

  await expect(tile(page, 'chcę')).toBeVisible();
  await tile(page, 'ty').click();
  // The label and the accessible name both follow the sentence.
  await expect(tile(page, 'chcesz')).toBeVisible();
  await tile(page, 'chcesz').click();
  await expect(sentence(page)).toHaveText(['ty', 'chcesz']);
  expect(await lastSpoken(page)).toBe('chcesz');
});
