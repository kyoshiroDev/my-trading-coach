import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, TEST_USER_PREMIUM, loginUser } from './helpers/auth';

test.describe('03 — Analytics FREE', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.goto('/analytics');
  });

  test('stats basiques visibles (win rate, P&L, trades)', async ({ page }) => {
    await expect(page.locator('[data-testid="analytics-win-rate"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="analytics-pnl"]')).toBeVisible();
    await expect(page.locator('[data-testid="analytics-trades"]')).toBeVisible();
  });

  test('blocs premium verrouillés avec overlay visible', async ({ page }) => {
    await expect(page.locator('[data-testid="locked-overlay"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('locked-overlay contient bouton "Essayer 7 jours gratuit"', async ({ page }) => {
    const cta = page.locator('[data-testid="upgrade-cta"]').first();
    await expect(cta).toBeVisible({ timeout: 5000 });
    await expect(cta).toContainText('7 jours');
  });
});

test.describe('03 — Analytics PREMIUM', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_PREMIUM);
    await page.goto('/analytics');
  });

  test('tous les blocs visibles — pas de locked-overlay', async ({ page }) => {
    await expect(page.locator('[data-testid="locked-overlay"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('heatmap présente', async ({ page }) => {
    await expect(page.locator('[data-testid="heatmap"]')).toBeVisible({ timeout: 5000 });
  });

  test('equity curve présente', async ({ page }) => {
    await expect(page.locator('[data-testid="equity-curve"]')).toBeVisible({ timeout: 5000 });
  });
});
