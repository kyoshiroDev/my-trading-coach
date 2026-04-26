import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src',
  // En CI : séquentiel (1 worker) pour éviter la contention réseau sur Vercel CDN
  // En local : 2 workers parallèles
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: 1,
  workers: isCI ? 1 : 2,
  // En CI : Angular bootstrap sur Vercel + réseau GitHub = plus lent
  timeout: isCI ? 45000 : 15000,
  expect: {
    timeout: isCI ? 15000 : 8000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: isCI ? 25000 : 10000,
    navigationTimeout: isCI ? 30000 : 15000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(!isCI && {
    webServer: {
      command: 'pnpm nx serve app-mytradingcoach',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 120000,
    },
  }),
});
