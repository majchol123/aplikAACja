import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import {
  devLogin,
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
    const headers = { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' };
    const home = await fetch('/api/boards/home', {
      method: 'POST',
      headers,
      body: JSON.stringify({ rows: 2, cols: 3 }),
    });
    const { boards } = (await home.json()) as { boards: { id: string }[] };
    const tile = await fetch(`/api/boards/${boards[0]!.id}/tiles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rev: 1, row: 0, col: 1, kind: 'word', label: 'pić' }),
    });
    const form = new FormData();
    form.set('label', 'Dom');
    const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
    form.set('image', new File([bytes], 'dom.webp', { type: 'image/webp' }));
    const upload = await fetch('/api/media', {
      method: 'POST',
      headers: { 'X-Aplikaacja': '1' },
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
  const targetId = await target.evaluate(async () => {
    const me = (await (await fetch('/api/me')).json()) as { id: string };
    return me.id;
  });
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
  // Going back to an earlier state is for superadmins.
  await expect(dialog.getByRole('heading', { name: 'Wcześniejszy stan konta' })).toHaveCount(0);

  // Read-only data view: the board as the account sees it, its photo and settings.
  await dialog.getByRole('button', { name: 'Pokaż dane konta' }).click();
  const preview = dialog.getByTestId('data-preview');
  await expect(
    preview.getByTestId('preview-grid').getByRole('button', { name: 'pić' }),
  ).toBeVisible();
  await preview.getByRole('button', { name: 'Zdjęcia' }).click();
  const photo = preview.getByRole('img', { name: 'Dom' });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
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
  // The log is shared with tests running at the same time: find this account's entry.
  const log = page.getByRole('table', { name: 'Dziennik zdarzeń' });
  const gone = log
    .getByRole('row')
    .filter({ hasText: `konto usunięte (${targetId.slice(0, 6)}…)` });
  await expect(gone.filter({ hasText: 'Usunięcie konta' })).toHaveCount(1);
  await other.close();
});

test('a superadmin turns encrypted backups on; the job reads with the token alone', async ({
  page,
  request,
}) => {
  // The backup config is one row for the whole deployment, and the projects run in parallel
  // workers: a second project enabling backups would revoke this one's token mid-test.
  test.skip(test.info().project.name !== 'desktop', 'one deployment-wide config, one project');
  await mockArasaac(page);
  // CI lists this address in ADMIN_EMAILS (.dev.vars.example); a developer's own .dev.vars
  // may not, and superadmin comes from nowhere else.
  const sub = `e2e-backup-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await devLogin(page, { sub, email: 'you@example.com', name: 'Superadmin' });
  const me = await page.evaluate(
    async () => (await (await fetch('/api/me')).json()) as { id: string; role: string },
  );
  test.skip(me.role !== 'superadmin', 'you@example.com is not in ADMIN_EMAILS here');

  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await page.getByRole('button', { name: 'Otwórz panel administratora' }).click();
  await page.getByRole('button', { name: 'Kopie zapasowe' }).click();
  const panel = page.getByRole('region', { name: 'Kopie zapasowe' });
  // A local run stopped halfway leaves backups on in the reused local D1.
  const turnOff = panel.getByRole('button', { name: 'Wyłącz kopie zapasowe' });
  await expect(
    turnOff.or(panel.getByRole('button', { name: 'Włącz kopie zapasowe' })),
  ).toBeVisible();
  if (await turnOff.isVisible()) {
    await turnOff.click();
    await panel.getByRole('button', { name: 'Tak, wyłącz' }).click();
  }
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const field = panel.getByLabel(/Klucz publiczny age/);
  await field.fill('age1nie-taki-klucz');
  await expect(panel.getByRole('button', { name: 'Włącz kopie zapasowe' })).toBeDisabled();
  await field.fill(recipient);
  await panel.getByRole('button', { name: 'Włącz kopie zapasowe' }).click();
  const token = await panel.getByLabel('Klucz dostępu zadania kopii').inputValue();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await expect(panel.getByTestId('backup-recipient')).toHaveText(recipient);
  await expect(panel.getByTestId('backup-last-run')).toHaveText('jeszcze nie było');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The job: plain IDs in the index, everything else an age file for that key.
  const auth = { Authorization: `Bearer ${token}` };
  const index = await request.get('/api/backup/index', { headers: auth });
  expect(index.status()).toBe(200);
  expect(((await index.json()) as { users: string[] }).users).toContain(me.id);
  const vault = await request.get(`/api/backup/users/${me.id}`, { headers: auth });
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const dump = JSON.parse(await decrypter.decrypt(new Uint8Array(await vault.body()), 'text')) as {
    kind: string;
    tables: Record<string, unknown>;
  };
  expect(dump.kind).toBe('vault');
  expect(Object.keys(dump.tables)).toContain('boards');
  expect((await request.get('/api/backup/index')).status()).toBe(401);

  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await page.getByRole('button', { name: 'Otwórz panel administratora' }).click();
  await page.getByRole('button', { name: 'Kopie zapasowe' }).click();
  await expect(panel.getByTestId('backup-last-run')).not.toHaveText('jeszcze nie było');
  await expect(panel.getByLabel('Klucz dostępu zadania kopii')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Wyłącz kopie zapasowe' }).click();
  await panel.getByRole('button', { name: 'Tak, wyłącz' }).click();
  await expect(panel.getByRole('button', { name: 'Włącz kopie zapasowe' })).toBeVisible();
  expect((await request.get('/api/backup/index', { headers: auth })).status()).toBe(401);
});
