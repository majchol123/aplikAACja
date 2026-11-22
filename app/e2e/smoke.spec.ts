import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CSP violations and runtime errors surface as console errors: fail on any of them.
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Expected auth/CSRF rejections (401/403) are logged by the browser too; anything else fails.
    if (msg.type() === 'error' && !/status of 40[13]/.test(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
});

test.afterEach(({ page }) => {
  expect((page as Page & { __errors?: string[] }).__errors ?? []).toEqual([]);
});

async function devLogin(page: Page, who: { sub: string; email: string; name: string }) {
  await page.goto('/');
  const status = await page.evaluate(async (body) => {
    const res = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relaacja': '1' },
      body: JSON.stringify(body),
    });
    return res.status;
  }, who);
  expect(status).toBe(204);
  await page.goto('/');
}

const VECTORS = resolve(import.meta.dirname, '../../packages/shared/test-vectors');
const TINY_WEBP = Buffer.from('UklGRhwAAABXRUJQVlA4TBAAAAAvB8ABAAdQwP5H/wMR0f8A', 'base64');

/** The ARASAAC mirror is a separate Worker in production; here the shared vectors stand in. */
async function mockArasaac(page: Page) {
  const index = readFileSync(resolve(VECTORS, 'sample-index.json'));
  const forms = readFileSync(resolve(VECTORS, 'sample-forms.json'));
  const manifest = {
    v: 1,
    set: 'arasaac',
    name: 'ARASAAC',
    index: 'index.00000000.json',
    forms: 'forms.00000000.json',
    count: 11,
  };
  await page.route('**/sym/arasaac/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
    if (path.endsWith('/index.00000000.json'))
      return route.fulfill({ body: index, contentType: 'application/json' });
    if (path.endsWith('/forms.00000000.json'))
      return route.fulfill({ body: forms, contentType: 'application/json' });
    if (path.endsWith('.webp'))
      return route.fulfill({ body: TINY_WEBP, contentType: 'image/webp' });
    return route.fulfill({ status: 404 });
  });
}

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
  await devLogin(page, { sub: 'e2e-parent', email: 'parent@example.com', name: 'Rodzic E2E' });
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
  // Fresh account per run: the test changes saved settings.
  const sub = `e2e-library-${test.info().project.name}-${Date.now()}`;
  await devLogin(page, { sub, email: `${sub}@example.com`, name: 'Biblioteka' });
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
  await expect(page.getByRole('checkbox', { name: 'ARASAAC' })).not.toBeChecked();
  // Without the flag the extra set is neither offered nor reachable.
  await expect(page.getByRole('checkbox')).toHaveCount(1);
  expect((await page.request.get('/sym/extra/manifest.json')).status()).toBe(403);
});

test('privacy policy shows the contact address', async ({ page }) => {
  await page.goto('/prywatnosc');
  await expect(page.locator('#contact a[href^="mailto:"]')).toHaveCount(1);
});
