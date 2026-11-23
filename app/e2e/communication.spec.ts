import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  devLogin,
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

const tile = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const sentence = (page: Page) => page.getByTestId('sentence-item');
const current = (page: Page) => page.getByTestId('current-board');

async function starterBoard(page: Page, name: string): Promise<string> {
  const sub = await freshLogin(page, name);
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(current(page)).toHaveText('Pulpit');
  return sub;
}

test('a sentence built through a folder is spoken (PLAN F2)', async ({ page }) => {
  await starterBoard(page, 'Zdanie');
  // PLAN §2.7: 9 words and 8 folders, the rest left for the parent; "Wszystkie symbole" first.
  await expect(page.getByTestId('board-grid').getByRole('button')).toHaveCount(18);
  await expect(tile(page, 'chcę').locator('img')).toHaveAttribute(
    'src',
    '/sym/arasaac/p/5441.0000abcd.webp',
  );

  await tile(page, 'chcę').click();
  await expect(sentence(page)).toHaveText(['chcę']);
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'chcę', voice: 'Zosia', pitch: 1 });

  await tile(page, 'Picie, folder').click();
  await expect(current(page)).toHaveText('Picie');
  await expect(page.getByRole('button', { name: 'Pulpit', exact: true })).toBeEnabled();
  await tile(page, 'sok').click();
  await expect(sentence(page)).toHaveText(['chcę', 'sok']);
  // Back on the home board after a word (default "return to home").
  await expect(current(page)).toHaveText('Pulpit');

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
  await expect(page.getByRole('navigation')).toContainText('Jedzenie›Śniadanie');
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
  await expect(current(page)).toHaveText('Pulpit');
});

test('on a phone, upright and sideways, tiles keep their shape and whole-word labels', async ({
  page,
}) => {
  await starterBoard(page, 'Telefon');
  for (const viewport of [
    { width: 412, height: 765 },
    { width: 842, height: 314 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(tile(page, 'dziękuję')).toBeVisible();
    const tiles = await page.getByTestId('board-grid').evaluate((grid) =>
      [...grid.querySelectorAll<HTMLElement>('[data-tile]')].map((el) => {
        const box = el.getBoundingClientRect();
        const label = el.querySelector<HTMLElement>('.tile-label')!;
        const style = getComputedStyle(label);
        return {
          label: label.textContent!,
          width: box.width,
          height: box.height,
          bottom: box.bottom,
          font: parseFloat(style.fontSize),
          lines: Math.round(label.getBoundingClientRect().height / parseFloat(style.lineHeight)),
        };
      }),
    );
    expect(tiles).toHaveLength(18);
    for (const t of tiles) {
      const where = `${t.label} at ${viewport.width}×${viewport.height}`;
      // The whole board fits the screen, tiles are neither strips nor towers.
      expect(t.bottom, where).toBeLessThanOrEqual(viewport.height);
      expect(t.width / t.height, where).toBeGreaterThan(1 / 1.35);
      expect(t.width / t.height, where).toBeLessThan(3.05);
      expect(t.height, where).toBeGreaterThanOrEqual(40);
      // Readable, and a word is never broken across lines.
      expect(t.font, where).toBeGreaterThanOrEqual(8);
      expect(t.lines, where).toBeLessThanOrEqual(t.label.split(' ').length);
    }
  }
  // Sideways, the bars share one row: the board starts high on the screen.
  const grid = (await page.getByTestId('board-grid').boundingBox())!;
  expect(grid.y).toBeLessThan(90);
});

test('a pinned board is where choosing a word comes back to, until unpinned', async ({ page }) => {
  await starterBoard(page, 'Pinezka');
  // Nothing to pin on the home board itself.
  await expect(page.getByRole('button', { name: 'Przypnij tablicę' })).toHaveCount(0);
  await tile(page, 'Picie, folder').click();
  const pin = page.getByRole('button', { name: 'Przypnij tablicę' });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');

  // Words on the pinned board keep it on screen...
  await tile(page, 'sok').click();
  await expect(current(page)).toHaveText('Picie');
  // ...and a word anywhere else comes back to it, the home board's words too.
  await page.getByRole('button', { name: 'Pulpit' }).click();
  await expect(current(page)).toHaveText('Pulpit');
  await tile(page, 'chcę').click();
  await expect(current(page)).toHaveText('Picie');
  await page.getByRole('button', { name: 'Pulpit' }).click();
  await page.getByRole('button', { name: 'Wróć do przypiętej tablicy: Picie' }).click();
  await expect(current(page)).toHaveText('Picie');
  await expect(sentence(page)).toHaveText(['sok', 'chcę']);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Kept on this device: the app opens on it again. Unpinned, words lead home again.
  await page.reload();
  await expect(current(page)).toHaveText('Picie');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await tile(page, 'woda').click();
  await expect(current(page)).toHaveText('Pulpit');
});

test('the search finds own tiles by an inflected word and adds library symbols (F3)', async ({
  page,
}) => {
  await starterBoard(page, 'Szukanie');
  await page.getByRole('button', { name: 'Szukaj' }).click();
  const search = page.getByRole('dialog', { name: 'Szukaj' });
  // The library is searched first; own tiles are one tab away.
  await expect(search.getByRole('tab', { name: 'Biblioteka symboli' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await search.getByRole('tab', { name: 'Moje kafelki' }).click();
  await search.getByRole('searchbox').fill('jablka');
  const found = search.getByRole('list', { name: 'Znalezione kafelki' }).getByRole('button');
  await expect(found).toHaveCount(1);
  await expect(found).toContainText('jabłko');
  await expect(found).toContainText('Pulpit › Jedzenie › Przekąski i owoce');
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);
  await found.click();
  await expect(search).toBeHidden();
  await expect(current(page)).toHaveText('Przekąski i owoce');
  await expect(tile(page, 'jabłko')).toHaveClass(/tile-found/);
  await expect(sentence(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Szukaj' }).click();
  await search.getByRole('searchbox').fill('jablka');
  await search
    .getByRole('list', { name: 'Znalezione symbole' })
    .getByRole('button', { name: 'jabłko' })
    .first()
    .click();
  await expect(search).toBeHidden();
  await expect(sentence(page)).toHaveText(['jabłko']);
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'jabłko' });
});

test('spoken sentences come back from the history; both follow the account (F3)', async ({
  page,
  browser,
}) => {
  const sub = await starterBoard(page, 'Historia');
  await tile(page, 'chcę').click();
  await tile(page, 'pomocy').click();
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();
  await expect(sentence(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  const panel = page.getByRole('dialog', { name: 'Historia i ulubione' });
  const recent = panel.getByRole('list', { name: 'Ostatnie wypowiedzi' });
  await expect(recent.getByRole('listitem')).toHaveCount(1);
  await recent.getByRole('button', { name: 'Dodaj do ulubionych: chcę pomocy' }).click();
  const favorites = panel.getByRole('list', { name: 'Ulubione frazy' });
  await expect(favorites.getByRole('button', { name: 'Powiedz: chcę pomocy' })).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);
  await favorites.getByRole('button', { name: 'Powiedz: chcę pomocy' }).click();
  await expect(panel).toBeHidden();
  await expect(sentence(page)).toHaveText(['chcę', 'pomocy']);
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'chcę pomocy' });

  // Favourites and the history are on the account: another device shows both.
  await page.reload();
  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  await expect(favorites.getByRole('listitem')).toHaveCount(1);
  await expect(recent.getByRole('listitem')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Zamknij' }).click();
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const phone = await other.newPage();
  await mockArasaac(phone, { withStarter: true });
  await devLogin(phone, { sub, email: `${sub}@example.com`, name: 'Historia' });
  await phone.getByRole('button', { name: 'Historia i ulubione' }).click();
  const phonePanel = phone.getByRole('dialog', { name: 'Historia i ulubione' });
  const phoneRecent = phonePanel.getByRole('list', { name: 'Ostatnie wypowiedzi' });
  await expect(phoneRecent.getByRole('listitem')).toHaveCount(1);
  await expect(phoneRecent.getByRole('button', { name: 'Powiedz: chcę pomocy' })).toBeVisible();
  await other.close();

  // Clearing empties it on every device; switched off, nothing more is kept.
  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  await panel.getByRole('button', { name: 'Wyczyść historię' }).click();
  await panel.getByRole('button', { name: 'Tak, wyczyść' }).click();
  await expect(panel).toContainText('Jeszcze nic nie powiedziano.');
  await favorites.getByRole('button', { name: 'Usuń z ulubionych: chcę pomocy' }).click();
  await expect(favorites.getByRole('listitem')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Zamknij' }).click();
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' },
      body: JSON.stringify({ keepHistory: false }),
    });
    return res.status;
  });
  expect(status).toBe(200);
  await page.reload();
  await tile(page, 'tak').click();
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  await expect(panel).toContainText('Historia jest wyłączona');
  await expect(recent.getByRole('listitem')).toHaveCount(0);
});

test('"Wszystkie symbole" in the first cell opens the category folders like boards (F3)', async ({
  page,
}) => {
  await starterBoard(page, 'Wszystkie symbole');
  const grid = page.getByTestId('board-grid');
  const all = tile(page, 'Wszystkie symbole, folder');
  // The first cell of the home board, on by default, with its ARASAAC picture.
  await expect(grid.getByRole('button').first()).toHaveAccessibleName('Wszystkie symbole, folder');
  await expect(all.locator('img')).toHaveAttribute('src', '/sym/arasaac/p/15018.0000abcd.webp');
  await all.click();
  await expect(page.getByRole('navigation')).toContainText('Wszystkie symbole');
  await tile(page, 'Odżywianie się, folder').click();
  await tile(page, 'Jedzenie, folder').click();
  await expect(current(page)).toHaveText('Jedzenie');
  // "Wstecz" goes up one category, the path leads anywhere above.
  await page.getByRole('button', { name: 'Wstecz' }).click();
  await expect(current(page)).toHaveText('Odżywianie się');
  await tile(page, 'Jedzenie, folder').click();
  await tile(page, 'Owoce, folder').click();
  await expect(page.getByRole('navigation')).toContainText(
    'Wszystkie symbole›Odżywianie się›Jedzenie›Owoce',
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  // A symbol goes to the sentence like a tile, and the home board comes back.
  await tile(page, 'jabłko').click();
  await expect(sentence(page)).toHaveText(['jabłko']);
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'jabłko' });
  await expect(current(page)).toHaveText('Pulpit');

  // Switched off in the settings, the cell stays empty: nothing else moves.
  const ja = (await tile(page, 'ja').boundingBox())!;
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' },
      body: JSON.stringify({ showAllSymbols: false }),
    });
    return res.status;
  });
  expect(status).toBe(200);
  await page.reload();
  await expect(tile(page, 'ja')).toBeVisible();
  await expect(all).toHaveCount(0);
  expect(await tile(page, 'ja').boundingBox()).toEqual(ja);
});
