import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { devLogin, failOnConsoleErrors, freshLogin, mockArasaac } from './support.ts';

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

test('signed-in parent sees the app and can sign out', async ({ page }) => {
  await freshLogin(page, 'Rodzic E2E');
  // A new account starts with the first-board choice; account settings are one tap away.
  await expect(page.getByRole('heading', { name: 'Przygotujmy pierwszą tablicę' })).toBeVisible();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(page.getByTestId('user-name')).toHaveText('Rodzic E2E');
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

  // Sexual content is hidden by default (PLAN §2.2).
  await box.fill('całować');
  await expect(page.getByText('Brak wyników.')).toBeVisible();

  // Active sets are saved on the account.
  await box.clear();
  await page.getByRole('checkbox', { name: 'ARASAAC' }).uncheck();
  await expect(page.getByText('0 symboli w aktywnych zestawach.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ustawienia i konto' }).click();
  await expect(page.getByRole('checkbox', { name: 'ARASAAC' })).not.toBeChecked();
  // Without the flag the extra set is neither offered nor reachable.
  await expect(library.getByRole('checkbox')).toHaveCount(1);
  expect((await page.request.get('/sym/extra/manifest.json')).status()).toBe(403);
});

test('privacy policy shows the contact address', async ({ page }) => {
  await page.goto('/prywatnosc');
  await expect(page.locator('#contact a[href^="mailto:"]')).toHaveCount(1);
});
