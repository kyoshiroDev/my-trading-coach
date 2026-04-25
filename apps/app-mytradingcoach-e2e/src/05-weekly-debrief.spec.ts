import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, TEST_USER_PREMIUM, loginUser, mockAnthropicDebrief } from './helpers/auth';

test.describe('05 — Weekly Debrief FREE', () => {

  test('FREE → paywall visible', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.goto('/debrief');
    await expect(page.locator('[data-testid="debrief-paywall"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('05 — Weekly Debrief PREMIUM', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_PREMIUM);
    await page.goto('/debrief');
  });

  test('bouton "Générer le débrief" visible', async ({ page }) => {
    await expect(page.locator('[data-testid="debrief-generate-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test('clic → mock → débrief affiché (summary, strengths, weaknesses, objectives)', async ({ page }) => {
    await mockAnthropicDebrief(page);
    await page.click('[data-testid="debrief-generate-btn"]');
    await expect(page.locator('[data-testid="debrief-summary"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="debrief-strengths"]')).toBeVisible();
    await expect(page.locator('[data-testid="debrief-weaknesses"]')).toBeVisible();
    await expect(page.locator('[data-testid="debrief-objectives"]')).toBeVisible();
  });

  test('débrief déjà généré → erreur limite affichée', async ({ page }) => {
    await page.route('**/api/debrief/generate', route => route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Débrief déjà généré aujourd\'hui. Réessaie demain.' }),
    }));
    await page.click('[data-testid="debrief-generate-btn"]');
    await expect(page.locator('.error-msg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error-msg')).toContainText('Réessaie');
  });
});
