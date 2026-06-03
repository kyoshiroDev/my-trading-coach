import { Page } from '@playwright/test';

export const FREE_USER = {
  email: process.env['E2E_FREE_EMAIL'] ?? 'free-e2e@test.com',
  password: process.env['E2E_FREE_PASSWORD'] ?? 'TestPassword123!',
};

export const PREMIUM_USER = {
  email: process.env['E2E_PREMIUM_EMAIL'] ?? 'premium-e2e@test.com',
  password: process.env['E2E_PREMIUM_PASSWORD'] ?? 'TestPassword123!',
};

export async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('[data-testid="login-email"]');
  await page.fill('[data-testid="login-email"]', email);
  await page.fill('[data-testid="login-password"]', password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL('**/dashboard');
  // Onboarding obligatoire (plus de bouton "Passer") : les comptes E2E doivent
  // être onboardés (onboardingCompleted=true), sinon l'overlay bloque l'app.
  const wizard = page.locator('[data-testid="onboarding-wizard"]');
  if (await wizard.isVisible({ timeout: 1000 }).catch(() => false)) {
    throw new Error(
      "Wizard d'onboarding visible : le compte de test E2E doit être onboardé (onboardingCompleted=true).",
    );
  }
}
