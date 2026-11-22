import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
