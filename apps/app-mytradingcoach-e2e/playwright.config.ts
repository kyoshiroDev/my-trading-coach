import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// Les specs de paiement (11-referral-ambassador) lisent DATABASE_URL et les clés
// Stripe de TEST depuis l'environnement. Playwright ne charge pas `.env` tout seul :
// on le fait ici. `override: false` → une variable déjà exportée gagne toujours,
// et rien n'est chargé en CI (secrets injectés par le workflow).
if (!process.env['CI']) {
  loadEnv({ path: resolve(__dirname, '../../.env'), override: false });
}

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:4200';
const isCI = !!process.env['CI'];
// Délai PAR TEST selon l'environnement (seul ce délai change, pas ceux des expect, actions et
// navigations). CI : 45 s, inchangé. Local : 60 s, le build de dev non optimisé étant plus lent
// (parcours d'inscription + onboarding de 12-activation mesurés de 18 à 42 s). Surcharge
// ponctuelle : E2E_TEST_TIMEOUT_MS=90000.
const testTimeout = Number(process.env['E2E_TEST_TIMEOUT_MS']) || (isCI ? 45000 : 60000);

export default defineConfig({
  testDir: './src',
  // En CI : séquentiel (1 worker) pour éviter la contention réseau sur Vercel CDN
  // En local : 2 workers parallèles
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: 1,
  workers: isCI ? 1 : 2,
  timeout: testTimeout,
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
