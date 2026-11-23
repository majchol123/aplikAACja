import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  devLogin,
  failOnConsoleErrors,
  freshLogin,
  mockArasaac,
  promoteToAdmin,
} from './support.ts';

failOnConsoleErrors();

test('landing page is public, accessible and links the privacy policy', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(res?.headers()['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tablice komunikacyjne');
  await expect(page.getByRole('link', { name: 'Zaloguj się przez Google' })).toHaveAttribute(
    'href',
    '/api/auth/login',
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('link', { name: 'Polityka prywatności' }).click();
  await expect(page).toHaveURL(/\/prywatnosc$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Polityka prywatności');
});

test('login button starts the Google OIDC flow with PKCE', async ({ page }) => {
  const res = await page.request.get('/api/auth/login', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const location = new URL(res.headers()['location']!);
  expect(location.host).toBe('accounts.google.com');
  expect(location.searchParams.get('code_challenge_method')).toBe('S256');
  expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/callback');
});

test('login errors are shown on the landing page', async ({ page }) => {
  await page.goto('/?blad=anulowano');
  await expect(page.getByRole('alert')).toHaveText('Logowanie zostało anulowane.');
  await expect(page).toHaveURL('http://localhost:5173/');
});

test('a signed-in user sees the app and can sign out', async ({ page }) => {
  await freshLogin(page, 'Konto E2E');
  // A new account starts with the first-board choice; account settings are one tap away.
  await expect(page.getByRole('heading', { name: 'Przygotujmy pierwszą tablicę' })).toBeVisible();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(page.getByTestId('user-name')).toHaveText('Konto E2E');
  await expect(page.locator('#landing')).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.getByRole('button', { name: 'Wyloguj', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Zaloguj się przez Google' })).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('cross-site style form post is rejected', async ({ page }) => {
  await devLogin(page, { sub: 'e2e-csrf', email: 'csrf@example.com', name: 'CSRF' });
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/settings', { method: 'PATCH', body: '{"returnToHome":false}' });
    return res.status;
  });
  expect(status).toBe(403);
});

test('symbol library finds inflected words typed without Polish letters', async ({ page }) => {
  await mockArasaac(page);
  await freshLogin(page, 'Biblioteka');
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  const library = page.getByRole('region', { name: 'Biblioteka symboli' });
  const box = page.getByRole('searchbox', { name: 'Szukaj symbolu' });
  await expect(page.getByText('11 symboli w aktywnych zestawach.')).toBeVisible();

  await box.fill('jablka');
  const first = page.getByTestId('library-results').getByRole('listitem').first();
  await expect(first).toContainText('jabłko');
  await expect(first.locator('img')).toHaveAttribute('src', /^\/sym\/arasaac\/p\/2462\./);
  await expect(page.getByText(/Sergio Palao, ARASAAC/)).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Content filter (PLAN §3.3): sexuality hidden by default, violence shown.
  const results = page.getByTestId('library-results');
  await box.fill('całować');
  await expect(page.getByText('Brak wyników.')).toBeVisible();
  await box.fill('bić');
  await expect(results).toContainText('bić');
  await library.getByRole('checkbox', { name: /Ukrywaj symbole o seksualności/ }).uncheck();
  await library.getByRole('checkbox', { name: /Ukrywaj symbole przemocy/ }).check();
  await expect(page.getByText('Brak wyników.')).toBeVisible();
  await box.fill('całować');
  await expect(results).toContainText('całować');
  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(
    library.getByRole('checkbox', { name: /Ukrywaj symbole o seksualności/ }),
  ).not.toBeChecked();
  await expect(library.getByRole('checkbox', { name: /Ukrywaj symbole przemocy/ })).toBeChecked();

  // Active sets are saved on the account.
  await box.clear();
  await page.getByRole('checkbox', { name: 'ARASAAC' }).uncheck();
  await expect(page.getByText('0 symboli w aktywnych zestawach.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(page.getByRole('checkbox', { name: 'ARASAAC' })).not.toBeChecked();
  // Without the flag the extra set is neither offered nor reachable.
  await expect(
    library.getByRole('group', { name: 'Aktywne zestawy symboli' }).getByRole('checkbox'),
  ).toHaveCount(1);
  expect((await page.request.get('/sym/extra/manifest.json')).status()).toBe(403);
});

test('the library is browsed by category; the content filter hides empty folders', async ({
  page,
}) => {
  await mockArasaac(page);
  await freshLogin(page, 'Kategorie');
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  const library = page.getByRole('region', { name: 'Biblioteka symboli' });
  await library.getByText('Kategorie', { exact: true }).click();

  // Top level in the order of the set; "Seksualność" holds only filtered symbols.
  const folders = library.getByTestId('category-folders').getByRole('button');
  await expect(folders).toHaveText([/Odżywianie się/, /Organizmy żywe/, /Komunikacja/]);
  await library.getByRole('button', { name: /^Odżywianie się, kategoria/ }).click();
  await expect(library.getByRole('heading', { name: 'Odżywianie się' })).toBeFocused();
  await library.getByRole('button', { name: 'Jedzenie, kategoria, symboli: 3' }).click();
  await library.getByRole('button', { name: /^Owoce, kategoria/ }).click();
  await expect(library.getByTestId('category-symbols').getByRole('listitem')).toHaveText([
    /jabłko/,
    /sok jabłkowy/,
  ]);
  const path = library.getByRole('navigation', { name: 'Ścieżka kategorii' });
  await expect(path.getByRole('button')).toHaveText([
    'Wszystkie kategorie',
    'Odżywianie się',
    'Jedzenie',
  ]);
  await expect(path.locator('[aria-current="page"]')).toHaveText('Owoce');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await path.getByRole('button', { name: 'Wszystkie kategorie' }).click();
  await library.getByRole('checkbox', { name: /Ukrywaj symbole o seksualności/ }).uncheck();
  await expect(folders).toHaveText([
    /Odżywianie się/,
    /Organizmy żywe/,
    /Komunikacja/,
    /Seksualność/,
  ]);
});

test('an admin changes the picture of a folder for every account', async ({ page, browser }) => {
  // The two projects may run at the same time: each changes its own folder.
  const desktop = test.info().project.name === 'desktop';
  const folder = desktop ? 'Odżywianie się' : 'Organizmy żywe';
  const key = desktop ? 'feeding' : 'living being';
  const auto = folder === 'Odżywianie się' ? /\/p\/2462\./ : /\/p\/2727\./;
  const picture = (where: typeof page) =>
    where
      .getByRole('region', { name: 'Biblioteka symboli' })
      .getByRole('button', { name: new RegExp(`^${folder}, kategoria`) })
      .locator('img');
  const openCategories = async (where: typeof page) => {
    await where.getByRole('button', { name: 'Ustawienia i konto' }).click();
    await where
      .getByRole('region', { name: 'Biblioteka symboli' })
      .getByText('Kategorie', { exact: true })
      .click();
  };

  await mockArasaac(page);
  promoteToAdmin(await freshLogin(page, 'Admin obrazki'));
  await page.reload();
  // A run that failed half-way may have left its choice behind (the table is global).
  const reset = await page.evaluate(async (key) => {
    const res = await fetch('/api/admin/category-icons', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Aplikaacja': '1' },
      body: JSON.stringify({ set: 'arasaac', key, symbol: null }),
    });
    return res.status;
  }, key);
  expect(reset).toBe(200);
  await openCategories(page);
  const library = page.getByRole('region', { name: 'Biblioteka symboli' });
  await expect(picture(page)).toHaveAttribute('src', auto);

  await library.getByRole('checkbox', { name: /Zmieniaj obrazki folderów/ }).check();
  await expect(library.getByText('Otwórz folder, którego obrazek chcesz zmienić.')).toBeVisible();
  await library.getByRole('button', { name: new RegExp(`^${folder}, kategoria`) }).click();
  const editor = library.getByRole('region', { name: `Obrazek folderu „${folder}”` });
  await expect(editor).toContainText('Automatyczny');
  await editor.getByRole('searchbox', { name: 'Szukaj obrazka w zestawie' }).fill('dzien dobry');
  await editor.getByRole('button', { name: /: dzień dobry$/ }).click();
  await expect(
    library.getByText(`Zapisano obrazek folderu „${folder}”: dzień dobry.`),
  ).toBeVisible();
  await expect(editor).toContainText('Wybrany przez administratora');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Another account sees the new picture.
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const reader = await other.newPage();
  await mockArasaac(reader);
  await freshLogin(reader, 'Czytelnik obrazkow');
  await openCategories(reader);
  await expect(picture(reader)).toHaveAttribute('src', /\/p\/7000\./);
  await other.close();

  await editor.getByRole('button', { name: 'Przywróć automatyczny' }).click();
  await expect(
    library.getByText(`Przywrócono automatyczny obrazek folderu „${folder}”.`),
  ).toBeVisible();
  await library.getByRole('button', { name: 'Wszystkie kategorie' }).click();
  await expect(picture(page)).toHaveAttribute('src', auto);
});

test('privacy policy shows the contact address', async ({ page }) => {
  await page.goto('/prywatnosc');
  await expect(page.locator('#contact a[href^="mailto:"]')).toHaveCount(1);
});
