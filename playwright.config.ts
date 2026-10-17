import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.PLAYWRIGHT_USE_BUNDLED_CHROMIUM && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false,
  workers: 1, timeout: 60_000, expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 }, launchOptions: { executablePath },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && node scripts/package-pages.mjs --serve',
    url: 'http://127.0.0.1:4173/aoe1/', reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
});
