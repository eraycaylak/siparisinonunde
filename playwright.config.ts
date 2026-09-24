// Uçtan uca testler (14 §10): Playwright 1.56 + Chromium (/opt/pw-browsers), mock WhatsApp/SMS.
//   pnpm e2e                    tüm senaryolar
//   pnpm e2e e2e/01-akis-a.spec.ts
// Sunucular: API + worker (4200) ve web (next dev, 3200, NEXT_DIST_DIR=.next-e2e); veritabanı siparis_e2e_test.
// globalSetup veritabanını sıfırlar + seed eder ve demo şubeyi 00:00–23:59 açık yapar.

import { defineConfig, devices } from '@playwright/test';
import { apiEnv, API_URL, ensureBrowsersPath, WEB_PORT, WEB_URL, webEnv } from './e2e/support/env';

ensureBrowsersPath();

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/e2e',
  // Senaryolar aynı demo işletmeyi ve canlı ekranı paylaşır: sırayla, tek worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: WEB_URL,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    actionTimeout: 20_000,
    // next dev ilk açılışta rotayı derler
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
  webServer: [
    {
      name: 'api+worker',
      // Önce veritabanı hazırlanır (yoksa oluşturulur + migrate), sonra API ve worker aynı anda başlar.
      command:
        'pnpm exec tsx e2e/support/prepare-db.ts && pnpm exec concurrently -k -n api,worker "pnpm --filter @siparis/api start" "pnpm --filter @siparis/api start:worker"',
      url: `${API_URL}/api/v1/health`,
      env: apiEnv(),
      reuseExistingServer: !CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
    {
      name: 'web',
      command: `pnpm --filter @siparis/web exec next dev -p ${WEB_PORT}`,
      url: `${WEB_URL}/panel/giris`,
      env: webEnv(),
      reuseExistingServer: !CI,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
});
