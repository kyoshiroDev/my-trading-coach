import { test, expect } from '@playwright/test';

/**
 * Helper — Login as a specific user.
 * Expects the API to be running at /api (via proxy or baseURL).
 */
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

test.describe('Analytics — utilisateur FREE', () => {
  test.beforeEach(async ({ page }) => {
    // Ce test nécessite un compte FREE existant dans la base de données
    // En CI, créer via POST /api/test/seed-free-user ou utiliser un compte de test
    await loginAs(page, process.env['E2E_FREE_EMAIL'] ?? 'free@test.com', process.env['E2E_FREE_PASSWORD'] ?? 'Password123!');
  });

  test('la page /analytics est accessible (pas de redirect)', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).not.toHaveURL(/\/dashboard/);
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('affiche la ligne de stats basiques', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.stats-free-row')).toBeVisible();
  });

  test('affiche les 2 blocs verrouillés pour FREE', async ({ page }) => {
    await page.goto('/analytics');
    const lockedBlocks = page.locator('.locked-feature');
    await expect(lockedBlocks).toHaveCount(2);
  });

  test('les blocs verrouillés ont un titre et un CTA', async ({ page }) => {
    await page.goto('/analytics');
    const firstLocked = page.locator('.locked-feature').first();
    await expect(firstLocked.locator('.locked-title')).toBeVisible();
    await expect(firstLocked.locator('.locked-cta')).toBeVisible();
  });

  test('le CTA verrouillé pointe vers ?plan=premium', async ({ page }) => {
    await page.goto('/analytics');
    const cta = page.locator('.locked-cta').first();
    const href = await cta.getAttribute('href');
    expect(href).toContain('plan=premium');
  });

  test('la heatmap PREMIUM n\'est pas visible pour FREE', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.heatmap')).not.toBeVisible();
  });

  test('la bannière upsell est visible sur le dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.premium-banner')).toBeVisible();
    await expect(page.locator('.premium-banner')).toContainText('29');
  });

  test('la route /ai-insights redirige les FREE vers /dashboard', async ({ page }) => {
    await page.goto('/ai-insights');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('la route /debrief redirige les FREE vers /dashboard', async ({ page }) => {
    await page.goto('/debrief');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
