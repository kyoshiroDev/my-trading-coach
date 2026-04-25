import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: isCI ? 60000 : 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: isCI ? 20000 : 15000,
    navigationTimeout: isCI ? 30000 : 20000,
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
