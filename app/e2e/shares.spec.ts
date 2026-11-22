import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  TINY_WEBP,
} from './support.ts';

failOnConsoleErrors();

/**
 * Home board "Start" with a folder "Jedzenie" holding a photo tile "zupa"; or, with
 * `empty`, a bare 2×2 home board.
 */
async function seed(page: Page, { empty = false } = {}): Promise<void> {
  const ok = await page.evaluate(
    async ({ photo, empty }) => {
      const headers = { 'Content-Type': 'application/json', 'X-Relaacja': '1' };
      const post = (path: string, body: unknown) =>
        fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
      const home = await post('/api/boards/home', { name: 'Start', rows: 2, cols: 2 });
      if (empty) return true;
      const start = home.boards[0];
      const folder = await post(`/api/boards/${start.id}/tiles`, {
        rev: 1,
        row: 0,
        col: 0,
        kind: 'folder',
        label: 'Jedzenie',
      });
      const food = folder.boards.find((b: { name: string }) => b.name === 'Jedzenie');
      const form = new FormData();
      form.set('label', 'Zupa');
      const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
      form.set('image', new File([bytes], 'zupa.webp', { type: 'image/webp' }));
      const upload = await fetch('/api/media', {
        method: 'POST',
        headers: { 'X-Relaacja': '1' },
        body: form,
      }).then((r) => r.json());
      const tile = await post(`/api/boards/${food.id}/tiles`, {
        rev: food.rev,
        row: 0,
        col: 0,
        kind: 'word',
        label: 'zupa',
        symbol: { set: 'own', ref: upload.media.id },
      });
      return Boolean(tile.boards);
    },
    { photo: TINY_WEBP.toString('base64'), empty },
  );
  expect(ok).toBe(true);
}

test('a board is sent to another account, looked at and accepted there', async ({
  page,
  browser,
}) => {
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const recipient = await other.newPage();
  await mockArasaac(recipient);
  const to = await freshLogin(recipient, 'Rodzic');
  await seed(recipient, { empty: true });

  await mockArasaac(page);
  await freshLogin(page, 'Terapeutka');
  await seed(page);
  await page.reload();
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Wyślij kopię' }).click();
  const send = page.getByRole('dialog', { name: 'Wyślij kopię tablicy „Start”' });
  await send
    .getByRole('textbox', { name: /Adres e-mail konta odbiorcy/ })
    .fill(`${to}@example.com`);
  await send.getByRole('button', { name: 'Wyślij', exact: true }).click();
  await expect(send.getByRole('status')).toContainText('Jeśli konto z tym adresem istnieje');
  // An address without an account gets exactly the same answer.
  await send.getByRole('textbox', { name: /Adres e-mail konta odbiorcy/ }).fill('nikt@example.com');
  await send.getByRole('button', { name: 'Wyślij', exact: true }).click();
  await expect(send.getByRole('status')).toContainText('Wysłano na adres nikt@example.com.');
  await expect(send.getByRole('status')).toContainText('Jeśli konto z tym adresem istnieje');
  await send.getByRole('button', { name: 'Zamknij' }).click();

  // The recipient finds it in edit mode, looks at it and adds it to the home board.
  await recipient.reload();
  await holdEditLock(recipient);
  await recipient.getByRole('button', { name: 'Otrzymane (1)' }).click();
  const inbox = recipient.getByRole('dialog', { name: 'Otrzymane tablice' });
  const item = inbox.getByRole('listitem', { name: 'Start' });
  await expect(item).toContainText('Od: Terapeutka');
  await item.getByRole('button', { name: 'Podgląd' }).click();
  await item.getByRole('button', { name: 'Otwórz folder Jedzenie' }).click();
  const soup = item.getByRole('button', { name: 'zupa' });
  await expect(soup).toBeVisible();
  expect(
    await soup.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  const axe = await new AxeBuilder({ page: recipient }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);
  await item.getByRole('button', { name: 'Dodaj na tablicę „Start”' }).click();
  await expect(inbox.getByRole('status')).toHaveText('Dodano folder „Start” na tablicy „Start”.');
  await expect(inbox).toContainText('Nie ma otrzymanych tablic.');
  await inbox.getByRole('button', { name: 'Zamknij' }).click();
  await expect(recipient.getByRole('button', { name: /^Zmień kafelek: Start/ })).toBeVisible();
  await expect(recipient.getByRole('button', { name: /^Otrzymane/ })).toBeHidden();

  // The sender sees the decision in the settings.
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  const sent = page.getByRole('list', { name: 'Wysłane tablice' });
  await expect(sent.getByRole('listitem')).toHaveCount(2);
  await expect(sent.getByRole('listitem').filter({ hasText: `${to}@example.com` })).toContainText(
    'przyjęta',
  );
  await expect(sent.getByRole('listitem').filter({ hasText: 'nikt@example.com' })).toContainText(
    'czeka na decyzję',
  );
  await other.close();
});
