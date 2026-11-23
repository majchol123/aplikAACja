import { expect, test, type Page } from '@playwright/test';
import { failOnConsoleErrors, freshLogin, mockArasaac, mockSpeech } from './support.ts';

failOnConsoleErrors();

/**
 * Request budget of the Free plan (PLAN §3.2, §7): 100 000 Worker requests a day for ~20
 * active accounts leaves ~300 per account. Only /api/* and /sym/extra/* reach the Worker
 * (the app files and the ARASAAC mirror are static assets), so those are counted here.
 */
const LIMITS = {
  /** First start of a fresh account up to its first board (6 when measured). */
  firstStart: 8,
  /** Opening the app again, e.g. a new day on the same tablet (3 when measured). */
  reopen: 4,
};

function countWorkerRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sym/extra/')) {
      seen.push(`${request.method()} ${url.pathname}`);
    }
  });
  return seen;
}

test('a typical day with the app stays within the request budget (PLAN §3.2)', async ({ page }) => {
  await mockArasaac(page, { withStarter: true });
  await mockSpeech(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'relaacja.device.v1',
      JSON.stringify({
        motor: { activateOn: 'release', minHoldMs: 0, sameTileGuardMs: 0, globalGuardMs: 0 },
      }),
    );
  });
  const requests = countWorkerRequests(page);
  await freshLogin(page, 'Budżet żądań');
  await page.getByRole('button', { name: /Tablica startowa/ }).click();
  await expect(page.getByTestId('current-board')).toHaveText('Start');
  await expect(page.getByRole('button', { name: 'chcę', exact: true })).toBeVisible();
  const firstStart = [...requests];
  expect(firstStart.length, firstStart.join('\n')).toBeLessThanOrEqual(LIMITS.firstStart);

  // Speaking costs no request: boards and sentence are in the browser, and the history goes
  // to the account in batches (here: once, when the history is opened).
  requests.length = 0;
  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: 'chcę', exact: true }).click();
    await page.getByRole('button', { name: 'Picie, folder', exact: true }).click();
    await page.getByRole('button', { name: 'sok', exact: true }).click();
    await page.getByRole('button', { name: 'Powiedz zdanie' }).click();
    await page.getByRole('button', { name: 'Wyczyść zdanie' }).click();
  }
  await page.getByRole('button', { name: 'Historia i ulubione' }).click();
  await page.getByRole('dialog', { name: 'Historia i ulubione' }).press('Escape');
  const speaking = [...requests].sort();
  // Opening the history sends the batch (its answer is the history) and reads the favourites.
  expect(speaking, speaking.join('\n')).toEqual(['GET /api/favorites', 'POST /api/history']);

  requests.length = 0;
  await page.reload();
  await expect(page.getByRole('button', { name: 'chcę', exact: true })).toBeVisible();
  const reopen = [...requests];
  expect(reopen.length, reopen.join('\n')).toBeLessThanOrEqual(LIMITS.reopen);
  test.info().annotations.push({
    type: 'requests',
    description: `first start ${firstStart.length}, speaking ${speaking.length}, reopen ${reopen.length}`,
  });
});
