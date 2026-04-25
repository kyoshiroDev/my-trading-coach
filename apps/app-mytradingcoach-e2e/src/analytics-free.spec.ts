import { test, expect } from '@playwright/test';
import { loginAs, FREE_USER } from './helpers/auth.helper';

test.describe('Analytics — utilisateur FREE', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FREE_USER.email, FREE_USER.password);
  });

  test('la page /analytics est accessible (pas de redirect)', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/dashboard/);
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('affiche la ligne de stats basiques', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.stats-row')).toBeVisible();
  });

  test('affiche les 3 blocs verrouillés pour FREE', async ({ page }) => {
    await page.goto('/analytics');
    const lockedBlocks = page.locator('.locked-feature');
    await expect(lockedBlocks).toHaveCount(3);
  });

  test('les blocs verrouillés ont un titre et un CTA', async ({ page }) => {
    await page.goto('/analytics');
    const firstLocked = page.locator('.locked-feature').first();
    await expect(firstLocked.locator('.locked-title')).toBeVisible();
    await expect(firstLocked.locator('.locked-cta')).toBeVisible();
  });

  test('le CTA verrouillé mentionne les 7 jours gratuits', async ({ page }) => {
    await page.goto('/analytics');
    const cta = page.locator('.locked-cta').first();
    await expect(cta).toBeVisible();
    await expect(cta).toContainText('7 jours');
  });

  test('la heatmap PREMIUM n\'est pas visible pour FREE', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.heatmap-wrapper')).not.toBeVisible();
  });

  test('la bannière upsell est visible sur le dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.premium-banner')).toBeVisible();
    await expect(page.locator('.premium-banner')).toContainText('39');
  });

  test('la route /ai-insights affiche un paywall pour FREE', async ({ page }) => {
    await page.goto('/ai-insights');
    await expect(page).toHaveURL(/\/ai-insights/);
    await expect(page.locator('[data-testid="ai-paywall"]')).toBeVisible({ timeout: 5000 });
  });

  test('la route /debrief affiche un paywall pour FREE', async ({ page }) => {
    await page.goto('/debrief');
    await expect(page).toHaveURL(/\/debrief/);
    await expect(page.locator('[data-testid="debrief-paywall"]')).toBeVisible({ timeout: 5000 });
  });
});
