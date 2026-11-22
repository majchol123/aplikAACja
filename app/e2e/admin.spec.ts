import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  mockArasaac,
  promoteToAdmin,
  TINY_WEBP,
} from './support.ts';

failOnConsoleErrors();

/** Home board with one word tile and one photo, written through the API like the editor. */
async function seedAccount(page: Page): Promise<void> {
  const status = await page.evaluate(async (photo) => {
    const headers = { 'Content-Type': 'application/json', 'X-Relaacja': '1' };
    const home = await fetch('/api/boards/home', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Start', rows: 2, cols: 3 }),
    });
    const { boards } = (await home.json()) as { boards: { id: string }[] };
    const tile = await fetch(`/api/boards/${boards[0]!.id}/tiles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rev: 1, row: 0, col: 0, kind: 'word', label: 'pić' }),
    });
    const form = new FormData();
    form.set('label', 'Dom');
    const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
    form.set('image', new File([bytes], 'dom.webp', { type: 'image/webp' }));
    const upload = await fetch('/api/media', {
      method: 'POST',
      headers: { 'X-Relaacja': '1' },
      body: form,
    });
    return [home.status, tile.status, upload.status];
  }, TINY_WEBP.toString('base64'));
  expect(status).toEqual([201, 201, 201]);
}

test('admin panel: statistics, data view, blocking and hard delete of an account', async ({
  page,
  browser,
}) => {
  // The account the admin works on, in a browser of its own.
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const target = await other.newPage();
  const sub = await freshLogin(target, 'Konto testowe');
  const email = `${sub}@example.com`;
  await seedAccount(target);
  await target.reload();
  await expect(target.getByTestId('board-grid')).toBeVisible();

  await mockArasaac(page);
  promoteToAdmin(await freshLogin(page, 'Admin panelu'));
  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await page.getByRole('button', { name: 'Otwórz panel administratora' }).click();
  await expect(page.getByRole('heading', { name: 'Panel administratora' })).toBeVisible();
  await expect(page.getByTestId('admin-stats')).toContainText('Konta');

  await page.getByRole('searchbox', { name: 'Szukaj po adresie lub nazwie' }).fill(sub);
  const accounts = page.getByRole('table', { name: 'Konta' });
  const row = accounts.getByRole('row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  // Counters copied from the vault after the writes above.
  await expect(row.getByRole('cell')).toHaveText([
    /Konto testowe/,
    'Użytkownik',
    /Aktywne/,
    /\d/,
    'dzisiaj',
    '1',
    '1',
    '1',
    /KB$/,
  ]);
  let axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await row.getByRole('button', { name: 'Konto testowe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Konto testowe' });
  await expect(dialog).toContainText(email);

  // Read-only data view: the board as the account sees it, its photo and settings.
  await dialog.getByRole('button', { name: 'Pokaż dane konta' }).click();
  const preview = dialog.getByTestId('data-preview');
  await expect(
    preview.getByTestId('preview-grid').getByRole('button', { name: 'pić' }),
  ).toBeVisible();
  await preview.getByRole('button', { name: 'Zdjęcia' }).click();
  const photo = preview.getByRole('img', { name: 'Dom' });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await preview.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(preview).toContainText('ARASAAC, Własne zdjęcia');
  axe = await new AxeBuilder({ page }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);

  // Blocking signs the account out everywhere; unblocking lets it back in.
  await dialog.getByRole('button', { name: 'Zablokuj konto' }).click();
  await dialog.getByRole('button', { name: 'Tak, zablokuj' }).click();
  await expect(dialog).toContainText(/Zablokowane od/);
  await target.reload();
  await expect(target.getByRole('link', { name: 'Zaloguj się przez Google' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Odblokuj konto' }).click();
  await expect(dialog.getByRole('button', { name: 'Zablokuj konto' })).toBeVisible();
  const history = dialog.getByRole('table', { name: `Historia konta ${email}` });
  await expect(history.getByRole('row')).toHaveCount(4);
  await expect(history).toContainText('Odblokowanie konta');
  await expect(history).toContainText('Zablokowanie konta');
  await expect(history).toContainText('Podgląd danych konta');

  // Hard delete, confirmed by typing the address.
  await dialog.getByRole('button', { name: 'Usuń konto…' }).click();
  const confirm = dialog.getByRole('button', { name: 'Usuń konto i wszystkie dane' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox', { name: /Wpisz adres e-mail konta/ }).fill(email.toUpperCase());
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);

  await page.getByRole('button', { name: 'Dziennik zdarzeń' }).click();
  const log = page.getByRole('table', { name: 'Dziennik zdarzeń' });
  await expect(log.getByRole('row').nth(1)).toContainText('Usunięcie konta');
  await expect(log.getByRole('row').nth(1)).toContainText('konto usunięte');
  await other.close();
});
