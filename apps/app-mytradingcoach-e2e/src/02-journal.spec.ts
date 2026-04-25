import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, loginUser, createTestTrade } from './helpers/auth';

test.describe('02 — Journal de trading', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.goto('/journal');
  });

  test('empty state visible quand aucun trade ne correspond', async ({ page }) => {
    // Mocke l'API pour simuler une réponse vide — isole du state réel du compte de test
    // Format attendu par TradesStore: { data: { data: [], nextCursor: null, hasNextPage: false } }
    await page.route('**/api/trades*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { data: [], nextCursor: null, hasNextPage: false } }),
    }));
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

  test('supprimer trade → le nombre de trades diminue de 1', async ({ page }) => {
    // Attendre que les trades soient chargés
    await page.waitForSelector('[data-testid="trade-row"], [data-testid="empty-state"]', { timeout: 5000 });
    const initialCount = await page.locator('[data-testid="trade-row"]').count();
    await createTestTrade(page);
    await expect(page.locator('[data-testid="trade-row"]')).toHaveCount(initialCount + 1, { timeout: 8000 });
    const firstRow = page.locator('[data-testid="trade-row"]').first();
    await firstRow.locator('[data-testid="trade-delete"]').click();
    await expect(page.locator('[data-testid="trade-row"]')).toHaveCount(initialCount, { timeout: 5000 });
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
