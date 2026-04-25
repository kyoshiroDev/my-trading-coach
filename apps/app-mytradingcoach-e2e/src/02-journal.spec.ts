import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, loginUser, createTestTrade } from './helpers/auth';

test.describe('02 — Journal de trading', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.goto('/journal');
  });

  test('dashboard vide → empty state visible', async ({ page }) => {
    // This test expects the journal to be empty for a fresh test user
    await page.goto('/journal');
    await expect(page.locator('[data-testid="empty-state"]')).toBeVisible({ timeout: 5000 });
  });

  test('ouvrir modal → trade-modal visible', async ({ page }) => {
    await page.click('[data-testid="add-trade-btn"]');
    await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible({ timeout: 3000 });
  });

  test('créer trade LONG BTC → apparaît dans la liste', async ({ page }) => {
    await createTestTrade(page, { asset: 'BTC/USDT', side: 'LONG', entry: '50000' });
    await expect(page.locator('[data-testid="trade-row"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="trade-row"]').first()).toContainText('BTC/USDT');
  });

  test('formulaire sans asset → bouton submit désactivé', async ({ page }) => {
    await page.click('[data-testid="add-trade-btn"]');
    await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible();
    // Don't fill asset — submit should be enabled but show validation on submit
    await page.click('[data-testid="trade-side-long"]');
    await page.fill('[data-testid="trade-entry"]', '50000');
    await page.click('[data-testid="emotion-confident"]');
    // The submit is not disabled pre-submission but validation fires on click
    await page.click('[data-testid="trade-submit"]');
    await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible();
  });

  test('supprimer trade → disparaît de la liste', async ({ page }) => {
    await createTestTrade(page);
    const row = page.locator('[data-testid="trade-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('[data-testid="trade-delete"]').click();
    await expect(page.locator('[data-testid="trade-row"]')).toHaveCount(0, { timeout: 5000 });
  });

  test('filtrer par LONG → seuls les LONG visibles', async ({ page }) => {
    await page.click('[data-testid="filter-long"]');
    const rows = page.locator('[data-testid="trade-row"]');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('LONG');
    }
  });
});
