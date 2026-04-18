import { test, expect } from '@playwright/test';
import { loginAs, PREMIUM_USER } from './helpers/auth.helper';

test.describe('Analytics — utilisateur PREMIUM', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PREMIUM_USER.email, PREMIUM_USER.password);
  });

  test('la page /analytics est accessible', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('aucun bloc verrouillé pour PREMIUM', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.locked-feature')).toHaveCount(0);
  });

  test('la heatmap est visible pour PREMIUM', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.heatmap-wrapper')).toBeVisible();
  });

  test('le canvas equity curve est présent', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('canvas.chart-canvas').first()).toBeAttached();
  });

  test('pas de bannière upsell sur le dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.premium-banner')).not.toBeVisible();
  });

  test('la route /ai-insights est accessible', async ({ page }) => {
    await page.goto('/ai-insights');
    await expect(page).toHaveURL(/\/ai-insights/);
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test('la route /debrief est accessible', async ({ page }) => {
    await page.goto('/debrief');
    await expect(page).toHaveURL(/\/debrief/);
    await expect(page).not.toHaveURL(/\/dashboard/);
  });
});
