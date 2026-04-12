import { test, expect } from '@playwright/test';

async function loginAs(
  page: Parameters<typeof test>[1] extends { page: infer P } ? P : any,
  email: string,
  password: string,
) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|analytics|journal)/, { timeout: 15000 });
}

test.describe('Analytics — utilisateur PREMIUM', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, process.env['E2E_PREMIUM_EMAIL'] ?? 'premium@test.com', process.env['E2E_PREMIUM_PASSWORD'] ?? 'Password123!');
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
