import { test, expect, Page } from '@playwright/test';

const FREE_USER = {
  email: process.env['E2E_FREE_EMAIL'] ?? 'free-e2e@test.com',
  password: process.env['E2E_FREE_PASSWORD'] ?? 'TestPassword123!',
};
const PREMIUM_USER = {
  email: process.env['E2E_PREMIUM_EMAIL'] ?? 'premium-e2e@test.com',
  password: process.env['E2E_PREMIUM_PASSWORD'] ?? 'TestPassword123!',
};

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.waitForSelector('[data-testid="login-email"]');
  await page.fill('[data-testid="login-email"]', user.email);
  await page.fill('[data-testid="login-password"]', user.password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('**/dashboard');
  // Ignorer le wizard d'onboarding s'il apparaît
  try {
    const wizard = page.locator('[data-testid="onboarding-wizard"]');
    if (await wizard.isVisible({ timeout: 2000 })) {
      await page.click('[data-testid="wizard-skip"]');
      await page.waitForSelector('[data-testid="onboarding-wizard"]', { state: 'hidden', timeout: 5000 });
    }
  } catch { /* wizard absent */ }
}

// HP1 — Auth
test('HP1 — login réussi → dashboard', async ({ page }) => {
  await login(page, FREE_USER);
  await expect(page).toHaveURL(/dashboard/);
});

// HP2 — Route protégée
test('HP2 — route protégée sans auth → redirect login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/login/);
});

// HP3 — Journal FREE
test('HP3 — FREE peut ouvrir le formulaire de trade', async ({ page }) => {
  await login(page, FREE_USER);
  await page.goto('/journal');
  await page.click('[data-testid="add-trade-btn"]');
  await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible();
});

// HP4 — Analytics FREE bloqué
test('HP4 — FREE voit les blocs verrouillés sur analytics', async ({ page }) => {
  await login(page, FREE_USER);
  await page.goto('/analytics');
  await expect(page.locator('[data-testid="locked-overlay"]').first()).toBeVisible();
});

// HP5 — PREMIUM débloqué
test('HP5 — PREMIUM accède à ai-insights sans paywall', async ({ page }) => {
  await login(page, PREMIUM_USER);
  await page.goto('/ai-insights');
  await expect(page.locator('[data-testid="analyze-btn"]')).toBeVisible();
});
