import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  devLogin,
  failOnConsoleErrors,
  freshLogin,
  holdEditLock,
  mockArasaac,
  mockSpeech,
  promoteToAdmin,
} from './support.ts';

failOnConsoleErrors();

test.beforeEach(async ({ page }) => {
  await mockArasaac(page, { withStarter: true });
  await mockSpeech(page);
  // The test taps faster than the default repeat guard allows.
  await page.addInitScript(() => {
    const key = 'aplikaacja.device.v1';
    if (!localStorage.getItem(key)) {
      localStorage.setItem(
        key,
        JSON.stringify({
          motor: { activateOn: 'release', minHoldMs: 0, sameTileGuardMs: 0, globalGuardMs: 0 },
        }),
      );
    }
  });
});

const tile = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openSettings(page: Page): Promise<void> {
  await holdEditLock(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
}

/** The account's own counters, as the data export reads them. */
async function usage(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/usage');
    return ((await res.json()) as { days: { utterances: number; tiles: number }[] }).days;
  });
}

test('usage counts reach the account as numbers only; switched off, they are gone', async ({
  page,
}) => {
  // Two edit-mode holds and a wrangler call (promoteToAdmin) take most of the default 30 s.
  test.setTimeout(60_000);
  const sub = await freshLogin(page, 'Liczniki');
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await tile(page, 'chcę').click();
  await tile(page, 'Picie, folder').click();
  await tile(page, 'sok').click();
  await page.getByRole('button', { name: 'Powiedz zdanie' }).click();

  // Counted on the device, not one request per tap.
  const waiting = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('aplikaacja.usage.pending.v1.'))
      .map(([, value]) => JSON.parse(value) as Record<string, unknown>),
  );
  expect(waiting.map((days) => Object.values(days))).toEqual([[{ utterances: 1, tiles: 2 }]]);
  expect(await usage(page)).toEqual([]);

  // The tablet goes to sleep (the page is hidden): the counts are sent.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => usage(page))
    .toEqual([expect.objectContaining({ utterances: 1, tiles: 2 })]);
  const sent = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('aplikaacja.usage.pending.v1.')),
  );
  expect(sent).toEqual([]);

  // The admin panel shows them per day (all accounts together).
  promoteToAdmin(sub);
  await page.reload();
  await openSettings(page);
  await page.getByRole('button', { name: 'Otwórz panel administratora' }).click();
  const chart = page.getByTestId('admin-usage');
  await expect(chart.getByRole('img', { name: /^Zdania: razem/ })).toBeVisible();
  await expect(chart.getByRole('img', { name: /^Kafelki: razem/ })).toBeVisible();
  await expect(page.getByTestId('admin-stats')).toContainText('Zdania w ostatnich 7 dniach');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Wróć do ustawień' }).click();

  // Switching the counters off deletes what was collected.
  const counters = page.getByRole('checkbox', { name: /Liczniki użycia dla administratora/ });
  await expect(counters).toBeChecked();
  await counters.uncheck();
  await expect(counters).not.toBeChecked();
  await expect.poll(() => usage(page)).toEqual([]);
});

test('an account deletes itself from the settings, confirmed by its address', async ({ page }) => {
  const sub = `e2e-delete-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${sub}@example.com`;
  await devLogin(page, { sub, email, name: 'Do usunięcia' });
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(page.getByTestId('board-grid')).toBeVisible();
  await openSettings(page);

  const panel = page.getByRole('region', { name: 'Usuń konto' });
  await panel.getByRole('button', { name: 'Usuń konto…' }).click();
  const field = panel.getByLabel(/wpisz adres e-mail tego konta/);
  const confirm = panel.getByRole('button', { name: 'Usuń konto na zawsze' });
  await field.fill('ktos-inny@example.com');
  await expect(confirm).toBeDisabled();
  await field.fill(email.toUpperCase());
  await expect(confirm).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await confirm.click();

  await expect(page.locator('#login-error')).toHaveText(
    'Konto zostało usunięte razem z tablicami, zdjęciami i ustawieniami.',
  );
  expect(await page.evaluate(async () => (await fetch('/api/me')).status)).toBe(401);
  // Signing in again starts from nothing: a new, empty account.
  await devLogin(page, { sub, email, name: 'Do usunięcia' });
  await expect(page.getByRole('button', { name: /Tablica startowa/ })).toBeVisible();
});
