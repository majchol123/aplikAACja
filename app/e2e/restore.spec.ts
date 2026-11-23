import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  backdateAccount,
  devLogin,
  failOnConsoleErrors,
  freshLogin,
  mockArasaac,
} from './support.ts';

// Local development keeps no SQLite history, so the server answers 503 (nothing changes);
// the restore itself is checked on staging.
failOnConsoleErrors({ expected: [503] });

test('a superadmin picks a moment of the last 30 days and confirms with the e-mail', async ({
  page,
  browser,
}) => {
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const target = await other.newPage();
  const sub = await freshLogin(target, 'Konto do przywrócenia');
  const email = `${sub}@example.com`;
  // Only the time since the account was created can be gone back to.
  backdateAccount(sub, 2);

  await mockArasaac(page);
  // CI lists this address in ADMIN_EMAILS (.dev.vars.example).
  const rootSub = `e2e-restore-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await devLogin(page, { sub: rootSub, email: 'you@example.com', name: 'Superadmin' });
  const me = await page.evaluate(
    async () => (await (await fetch('/api/me')).json()) as { role: string },
  );
  test.skip(me.role !== 'superadmin', 'you@example.com is not in ADMIN_EMAILS here');

  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await page.getByRole('button', { name: 'Otwórz panel administratora' }).click();
  await page.getByRole('searchbox', { name: 'Szukaj po adresie lub nazwie' }).fill(sub);
  const row = page
    .getByRole('table', { name: 'Konta' })
    .getByRole('row')
    .filter({ hasText: email });
  await row.getByRole('button', { name: 'Konto do przywrócenia' }).click();
  const dialog = page.getByRole('dialog', { name: 'Konto do przywrócenia' });
  const section = dialog.getByRole('region', { name: 'Wcześniejszy stan konta' });
  await expect(section).toContainText('z ostatnich 30 dni');

  await section.getByRole('button', { name: 'Przywróć wcześniejszy stan…' }).click();
  const when = section.getByLabel('Stan z chwili');
  await expect(when).not.toHaveValue('');
  const submit = section.getByRole('button', { name: /^Przywróć stan/ });
  await expect(submit).toBeDisabled();
  await section.getByRole('textbox', { name: /Wpisz adres e-mail konta/ }).fill(email);
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveText(/^Przywróć stan z /);
  // Older than the 30 days Cloudflare keeps.
  await when.fill('2020-01-01T00:00');
  await expect(section).toContainText('Wybierz chwilę między');
  await expect(submit).toBeDisabled();
  await when.fill(
    await page.evaluate(() => {
      const d = new Date(Date.now() - 2 * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }),
  );
  expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([]);
  await submit.click();
  await expect(section.getByRole('alert')).toContainText('Nic się nie zmieniło');
  // Nothing happened, so nothing is in the account's history.
  await expect(dialog).not.toContainText('Przywrócenie wcześniejszego stanu konta');
  await other.close();
});
