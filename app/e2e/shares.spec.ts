import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import {
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  promoteToAdmin,
  TINY_WEBP,
} from './support.ts';

failOnConsoleErrors();

/**
 * Home board "Pulpit" with a folder "Jedzenie" holding a photo tile "zupa"; or, with
 * `empty`, a bare 2×2 home board.
 */
async function seed(page: Page, { empty = false } = {}): Promise<void> {
  const ok = await page.evaluate(
    async ({ photo, empty }) => {
      const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
      const post = (path: string, body: unknown) =>
        fetch(path, { method: 'POST', headers, body: JSON.stringify(body) }).then((r) => r.json());
      const home = await post('/api/boards/home', { rows: 2, cols: 2 });
      if (empty) return true;
      const start = home.boards[0];
      const folder = await post(`/api/boards/${start.id}/tiles`, {
        rev: 1,
        row: 0,
        col: 1,
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
        headers: { 'X-Aplikaacja': '1' },
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
  await page.getByRole('button', { name: 'Udostępnij' }).click();
  const send = page.getByRole('dialog', { name: 'Udostępnij tablicę „Pulpit”' });
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
  await send.getByRole('button', { name: 'Zamknij', exact: true }).click();

  // The recipient finds it in edit mode, looks at it and adds it to the home board.
  await recipient.reload();
  await holdEditLock(recipient);
  await recipient.getByRole('button', { name: 'Dodaj tablicę (otrzymane: 1)' }).click();
  const inbox = recipient.getByRole('dialog', { name: 'Dodaj tablicę', exact: true });
  const item = inbox.getByRole('listitem', { name: 'Pulpit' });
  await expect(item).toContainText('Od: Terapeutka');
  await item.getByRole('button', { name: 'Podgląd' }).click();
  await item.getByRole('button', { name: 'Otwórz folder Jedzenie' }).click();
  const soup = item.getByRole('button', { name: 'zupa' });
  await expect(soup).toBeVisible();
  await expect
    .poll(() =>
      soup.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBeGreaterThan(0);
  const axe = await new AxeBuilder({ page: recipient }).include('dialog').analyze();
  expect(axe.violations).toEqual([]);
  // Where it goes: the first free cell comes preselected, another one is a tap away.
  await item.getByRole('button', { name: 'Dodaj…' }).click();
  const place = recipient.getByRole('dialog', { name: 'Gdzie dodać „Pulpit”?' });
  // The home board's first cell is "Wszystkie symbole".
  await expect(
    place.getByRole('button', { name: 'Wiersz 1, kolumna 1: Wszystkie symbole (stałe pole)' }),
  ).toBeDisabled();
  await expect(
    place.getByRole('button', { name: 'Wiersz 1, kolumna 2: tu będzie „Pulpit”' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await place.getByRole('button', { name: 'Wiersz 2, kolumna 2: puste' }).click();
  await expect(
    place.getByRole('button', { name: 'Wiersz 2, kolumna 2: tu będzie „Pulpit”' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(place.getByRole('button', { name: 'Wiersz 1, kolumna 2: puste' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const placeAxe = await new AxeBuilder({ page: recipient }).include('dialog').analyze();
  expect(placeAxe.violations).toEqual([]);
  await place.getByRole('button', { name: 'Dodaj tutaj' }).click();
  await expect(place).toBeHidden();
  await expect(inbox.getByText('Dodano folder „Pulpit” na tablicy „Pulpit”.')).toBeVisible();
  await expect(inbox).toContainText('Nie ma otrzymanych tablic.');
  await inbox.getByRole('button', { name: 'Zamknij' }).click();
  await expect(recipient.getByRole('button', { name: /^Zmień kafelek: Pulpit/ })).toBeVisible();
  await expect(
    recipient.getByRole('button', { name: 'Dodaj kafelek: wiersz 1, kolumna 2' }),
  ).toBeVisible();
  await expect(
    recipient.getByRole('button', { name: 'Dodaj kafelek: wiersz 2, kolumna 2' }),
  ).toHaveCount(0);
  await expect(recipient.getByRole('button', { name: 'Dodaj tablicę', exact: true })).toBeVisible();

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

test('a board is saved to an Open Board file and read back on another account', async ({
  page,
  browser,
}) => {
  await mockArasaac(page);
  await freshLogin(page, 'Zapis do pliku');
  await seed(page);
  await page.reload();
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Udostępnij' }).click();
  const dialog = page.getByRole('dialog', { name: 'Udostępnij tablicę „Pulpit”' });
  const saving = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Zapisz tę tablicę do pliku' }).click();
  const file = await saving;
  expect(file.suggestedFilename()).toBe('Pulpit.obz');
  await expect(dialog.getByRole('status')).toHaveText('Zapisano plik Pulpit.obz.');
  const path = await file.path();

  const other = await browser.newContext({ serviceWorkers: 'block' });
  const reader = await other.newPage();
  await mockArasaac(reader);
  await freshLogin(reader, 'Odczyt z pliku');
  await seed(reader, { empty: true });
  await reader.reload();
  await holdEditLock(reader);
  await reader.getByRole('button', { name: 'Dodaj tablicę', exact: true }).click();
  const load = reader.getByRole('dialog', { name: 'Dodaj tablicę', exact: true });
  await load.locator('input[type="file"]').setInputFiles(path);
  await expect(load.getByTestId('file-summary')).toHaveText(
    /„Pulpit”: 2 tablice, 2 kafelki, 1 zdjęcie/,
  );
  await load.getByTestId('file-summary').getByRole('button', { name: 'Dodaj…' }).click();
  await reader
    .getByRole('dialog', { name: 'Gdzie dodać „Pulpit”?' })
    .getByRole('button', { name: 'Dodaj tutaj' })
    .click();
  await expect(load.getByText('Dodano folder „Pulpit” na tablicy „Pulpit”.')).toBeVisible();
  await load.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await reader.getByRole('button', { name: 'Otwórz folder Pulpit' }).click();
  await reader.getByRole('button', { name: 'Otwórz folder Jedzenie' }).click();
  const soup = reader.getByRole('button', { name: /^Zmień kafelek: zupa$/ });
  await expect(soup.locator('img')).toHaveAttribute('src', /^\/api\/media\//);
  // Garbage is refused with a message, nothing changes.
  await reader.getByRole('button', { name: 'Dodaj tablicę', exact: true }).click();
  const again = reader.getByRole('dialog', { name: 'Dodaj tablicę', exact: true });
  await again.locator('input[type="file"]').setInputFiles({
    name: 'zly.obz',
    mimeType: 'application/zip',
    buffer: Buffer.from('nie zip'),
  });
  await expect(again.getByRole('alert')).toHaveText(
    'To nie jest plik .obz ani .obf (Open Board Format).',
  );
  await other.close();
});

test('an admin publishes a board in the catalogue; another account adds it', async ({
  page,
  browser,
}) => {
  await mockArasaac(page);
  promoteToAdmin(await freshLogin(page, 'Admin katalogu'));
  await seed(page);
  await page.reload();
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Otwórz folder Jedzenie' }).click();
  await page.getByRole('button', { name: 'Udostępnij' }).click();
  const share = page.getByRole('dialog', { name: 'Udostępnij tablicę „Jedzenie”' });
  const title = `Jedzenie ${test.info().project.name} ${Date.now()}`;
  await share.getByRole('textbox', { name: 'Nazwa w katalogu' }).fill(title);
  await share.getByRole('textbox', { name: /Opis/ }).fill('Posiłki w domu');
  // Own photos stay out unless the admin says so.
  await expect(
    share.getByRole('checkbox', { name: /Dołącz moje zdjęcia \(1\)/ }),
  ).not.toBeChecked();
  await share.getByRole('button', { name: 'Opublikuj w katalogu' }).click();
  await expect(share.getByText(`Opublikowano „${title}” w katalogu.`)).toBeVisible();

  const other = await browser.newContext({ serviceWorkers: 'block' });
  const reader = await other.newPage();
  await mockArasaac(reader);
  await freshLogin(reader, 'Czytelnik katalogu');
  await seed(reader, { empty: true });
  await reader.reload();
  await holdEditLock(reader);
  await reader.getByRole('button', { name: 'Dodaj tablicę', exact: true }).click();
  const add = reader.getByRole('dialog', { name: 'Dodaj tablicę', exact: true });
  const entry = add.getByRole('listitem', { name: title });
  await expect(entry).toContainText('Posiłki w domu');
  await expect(entry).toContainText('1 tablica, 1 kafelek');
  await expect(entry.getByRole('button', { name: 'Wycofaj z katalogu' })).toBeHidden();
  await entry.getByRole('button', { name: 'Podgląd' }).click();
  await expect(entry.getByRole('button', { name: 'zupa' })).toBeVisible();
  await entry.getByRole('button', { name: 'Dodaj…' }).click();
  await reader
    .getByRole('dialog', { name: `Gdzie dodać „${title}”?` })
    .getByRole('button', { name: 'Dodaj tutaj' })
    .click();
  await expect(add.getByText(`Dodano folder „${title}” na tablicy „Pulpit”.`)).toBeVisible();
  await add.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await expect(reader.getByRole('button', { name: `Otwórz folder ${title}` })).toBeVisible();
  await other.close();

  // The admin publishes a new version over the entry, this time with the photo.
  await share.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj tablicę', exact: true }).click();
  const mine = page
    .getByRole('dialog', { name: 'Dodaj tablicę', exact: true })
    .getByRole('listitem', { name: title });
  await mine.getByRole('button', { name: 'Aktualizuj zawartość' }).click();
  await expect(mine).toContainText('Zawartość wpisu zastąpi tablica „Jedzenie”');
  await mine.getByRole('checkbox', { name: /Dołącz moje zdjęcia/ }).check();
  await mine.getByRole('button', { name: 'Tak, aktualizuj' }).click();
  await expect(mine.getByRole('status')).toHaveText(
    /^Zaktualizowano zawartość: 1 tablica, 1 kafelek, 1 zdjęcie/,
  );
  await expect(mine).toContainText('Posiłki w domu');

  // ...and withdraws it again.
  await mine.getByRole('button', { name: 'Wycofaj z katalogu' }).click();
  await mine.getByRole('button', { name: 'Tak, wycofaj' }).click();
  await expect(mine).toBeHidden();
});

test('without access to the extra set, an ARASAAC symbol found by the label stands in', async ({
  page,
}) => {
  await mockArasaac(page);
  await freshLogin(page, 'Bez zestawu');
  const ok = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
    const post = (path: string, body: unknown) =>
      fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    const home = await post('/api/boards/home', { rows: 2, cols: 2 });
    const start = (await home.json()).boards[0];
    const pkg = {
      v: 1,
      name: 'Od kogoś',
      board: {
        rows: 1,
        cols: 2,
        tiles: [
          { row: 0, col: 0, kind: 'word', label: 'pije', symbol: { set: 'extra', ref: '17' } },
          { row: 0, col: 1, kind: 'word', label: 'qwxyz', symbol: { set: 'extra', ref: '18' } },
        ],
      },
    };
    return (await post(`/api/boards/${start.id}/import`, { rev: start.rev, package: pkg })).ok;
  });
  expect(ok).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Od kogoś, folder', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'pije', exact: true }).locator('img'),
  ).toHaveAttribute('src', /\/6061\./);
  // No match: the label alone, as before.
  await expect(page.getByRole('button', { name: 'qwxyz', exact: true }).locator('img')).toHaveCount(
    0,
  );
  // The stored reference stays: the original comes back with the grant.
  const stored = await page.evaluate(async () => {
    const tree = await fetch('/api/boards').then((r) => r.json());
    return tree.boards.flatMap((b: { tiles: { label: string; symbol: unknown }[] }) =>
      b.tiles.filter((t) => t.label === 'pije').map((t) => t.symbol),
    );
  });
  expect(stored).toEqual([{ set: 'extra', ref: '17' }]);
});

test('the whole account is saved as one file from the settings (GDPR art. 20)', async ({
  page,
}) => {
  await mockArasaac(page);
  await freshLogin(page, 'Kopia danych');
  await seed(page);
  const ok = await page.evaluate(async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
    const post = (path: string, body: unknown) =>
      fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    const said = [{ label: 'chcę', symbol: null }];
    const a = await post('/api/favorites', { items: [{ label: 'dziękuję', symbol: null }] });
    const b = await post('/api/history', { entries: [{ at: Date.now(), items: said }] });
    return a.ok && b.ok;
  });
  expect(ok).toBe(true);
  await page.reload();
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  const panel = page.getByRole('region', { name: 'Twoje dane' });
  const saving = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Pobierz kopię moich danych' }).click();
  const file = await saving;
  expect(file.suggestedFilename()).toMatch(/^aplikaacja-dane-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(panel.getByRole('status')).toHaveText(/^Zapisano plik aplikaacja-dane-/);
  const zip = unzipSync(new Uint8Array(await readFile(await file.path())));
  expect(Object.keys(zip).sort()).toEqual([
    'CZYTAJ.txt',
    'dane.json',
    'tablice.obz',
    'zdjecia/0001-Zupa.webp',
  ]);
  const data = JSON.parse(strFromU8(zip['dane.json']!));
  expect(data).toMatchObject({
    format: 'aplikaacja-account-export',
    v: 1,
    account: { displayName: 'Kopia danych' },
    favorites: [{ items: [{ label: 'dziękuję' }] }],
    history: [{ items: [{ label: 'chcę' }] }],
    device: { pinSet: false },
    photos: [{ label: 'Zupa', file: 'zdjecia/0001-Zupa.webp' }],
  });
  expect(data.device).not.toHaveProperty('pin');
  expect(data.settings).toHaveProperty('keepHistory', true);
  // The boards inside are an Open Board archive of the whole tree.
  const obz = unzipSync(zip['tablice.obz']!);
  const manifest = JSON.parse(strFromU8(obz['manifest.json']!));
  expect(Object.keys(manifest.paths.boards)).toHaveLength(2);
});
