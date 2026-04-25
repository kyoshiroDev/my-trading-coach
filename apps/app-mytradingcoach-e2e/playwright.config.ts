import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  // 60s par test en CI (chargement Angular sur Vercel + appel API vers VPS)
  // 30s en local (dev server local, plus rapide)
  timeout: isCI ? 60000 : 30000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Timeout des actions (click, fill, waitForSelector) indépendant du timeout test
    actionTimeout: isCI ? 20000 : 10000,
    // Timeout de navigation (page.goto, waitForURL)
    navigationTimeout: isCI ? 30000 : 15000,
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
