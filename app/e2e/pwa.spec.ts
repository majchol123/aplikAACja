import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { failOnConsoleErrors, freshLogin, mockSpeech, TINY_WEBP } from './support.ts';

failOnConsoleErrors({ offline: true });
test.use({ serviceWorkers: 'allow' });

async function cachedPaths(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });
}

async function controlled(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Activation and clients.claim() take longer while the rest of the suite runs in parallel.
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true);
}

test('the app can be installed: manifest, icons and theme', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const res = await request.get(href!);
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as {
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({ start_url: '/', display: 'standalone', lang: 'pl' });
  expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const src of [...manifest.icons.map((i) => i.src), '/icons/apple-touch-icon.png']) {
    const icon = await request.get(src);
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()['content-type'], src).toBe('image/png');
  }
  const sw = await request.get('/sw.js');
  expect(sw.headers()['content-type']).toMatch(/javascript/);
  expect(sw.headers()['cache-control']).toBe('no-cache');
});

test('the service worker keeps public files only and explains a lost connection', async ({
  page,
  context,
}) => {
  await mockSpeech(page);
  // Requests the worker makes itself reach context-level routes.
  await context.route('**/sym/arasaac/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('.webp'))
      return route.fulfill({ body: TINY_WEBP, contentType: 'image/webp' });
    return route.fulfill({ status: 404 });
  });
  await freshLogin(page, 'PWA');
  await controlled(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Przygotujmy pierwszą tablicę' })).toBeVisible();

  // A symbol image fetched through the worker is cached; private paths never are.
  await page.evaluate(async () => {
    await fetch('/sym/arasaac/p/2462.0a1b2c3d.webp');
    await fetch('/api/me');
  });
  await expect
    .poll(async () => (await cachedPaths(page))['aplikaacja-arasaac-v1'] ?? [])
    .toEqual(['/sym/arasaac/p/2462.0a1b2c3d.webp']);
  const all = await cachedPaths(page);
  expect(Object.keys(all).sort()).toEqual([
    'aplikaacja-arasaac-v1',
    'aplikaacja-pages-v1',
    'aplikaacja-shell-v1',
  ]);
  expect(all['aplikaacja-pages-v1']).toEqual(['/']);
  expect(all['aplikaacja-shell-v1']!.length).toBeGreaterThan(0);
  expect(all['aplikaacja-shell-v1']!.every((p) => p.startsWith('/assets/'))).toBe(true);
  expect(
    Object.values(all)
      .flat()
      .filter((p) => p.startsWith('/api/') || p.startsWith('/sym/extra/')),
  ).toEqual([]);

  // Offline: the cached page starts and says why nothing works, instead of a login screen.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Brak połączenia z internetem');
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Przygotujmy pierwszą tablicę' })).toBeVisible();
});

test('the about page credits ARASAAC and PoliMorf', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'O aplikacji' }).click();
  await expect(page).toHaveURL(/\/o-aplikacji$/);
  await expect(page.getByRole('heading', { name: 'Symbole ARASAAC' })).toBeVisible();
  await expect(page.locator('#arasaac')).toContainText('Autor symboli: Sergio Palao');
  await expect(page.locator('#arasaac a[href*="by-nc-sa/4.0"]')).toHaveCount(1);
  await expect(page.locator('#polimorf')).toContainText('BSD 2-Clause');
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('the help page explains the device settings and is reachable from every page', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Pomoc' }).click();
  await expect(page).toHaveURL(/\/pomoc$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pomoc' })).toBeVisible();
  for (const id of ['start', 'mowienie', 'edycja', 'glos', 'instalacja', 'blokada']) {
    await expect(page.locator(`#${id} h2`)).toBeVisible();
  }
  await expect(page.locator('#blokada')).toContainText('Dostęp nadzorowany');
  await expect(page.locator('#blokada')).toContainText('Przypinanie aplikacji');
  // Every entry of the table of contents leads to its section.
  const targets = await page
    .getByRole('navigation', { name: 'Spis treści' })
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).hash));
  expect(targets.length).toBeGreaterThan(5);
  for (const hash of targets) await expect(page.locator(hash)).toHaveCount(1);
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const path of ['/o-aplikacji', '/prywatnosc']) {
    await page.goto(path);
    await expect(page.getByRole('link', { name: 'Pomoc', exact: true })).toHaveAttribute(
      'href',
      '/pomoc',
    );
  }
});
