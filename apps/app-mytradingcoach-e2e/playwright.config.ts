import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  timeout: 15000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // En CI, l'app tourne déjà sur BASE_URL (env dev Vercel + VPS) — pas de webServer.
  // En local, on démarre le dev server automatiquement.
  ...(!isCI && {
    webServer: {
      command: 'pnpm nx serve app-mytradingcoach',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 120000,
    },
  }),
});
