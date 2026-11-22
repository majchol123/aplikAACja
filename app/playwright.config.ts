import { defineConfig, devices } from '@playwright/test';

// Locally an already-downloaded Chromium can be reused: PW_CHROMIUM_PATH=/path/to/chrome
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // A service worker would answer requests before page.route() mocks see them; the one
    // test of the worker itself (pwa.spec.ts) allows it.
    serviceWorkers: 'block',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'tablet-android', use: { ...devices['Galaxy Tab S9'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Production build served by workerd (vite preview), with .dev.vars enabling the fake login.
    command: 'pnpm db:migrate:local && pnpm build && pnpm exec vite preview',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
