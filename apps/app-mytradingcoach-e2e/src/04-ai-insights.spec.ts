import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, TEST_USER_PREMIUM, loginUser, mockAnthropicInsights } from './helpers/auth';

test.describe('04 — IA Insights FREE', () => {

  test('FREE → paywall visible', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.goto('/ai-insights');
    await expect(page.locator('[data-testid="ai-paywall"]')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('04 — IA Insights PREMIUM', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_PREMIUM);
    await page.goto('/ai-insights');
  });

  test('bouton "Analyser maintenant" visible', async ({ page }) => {
    await expect(page.locator('[data-testid="analyze-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test('clic analyse → mock → insights affichés', async ({ page }) => {
    await mockAnthropicInsights(page);
    await page.click('[data-testid="analyze-btn"]');
    await expect(page.locator('[data-testid="insights-list"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="insight-card"]').first()).toBeVisible();
  });

  test('erreur overloaded → message lisible affiché', async ({ page }) => {
    await page.route('**/api/ai/insights', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: "L'IA est momentanément surchargée, réessaie dans quelques minutes." }),
    }));
    await page.click('[data-testid="analyze-btn"]');
    await expect(page.locator('.error-msg')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error-msg')).toContainText('surchargée');
  });

  test('chat → envoyer message → mock → réponse affichée', async ({ page }) => {
    await page.route('**/api/ai/chat', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { response: "Voici mon analyse de tes trades récents." } }),
    }));
    await page.fill('[data-testid="chat-input"]', 'Quand est-ce que je trade le mieux ?');
    await page.click('[data-testid="chat-send"]');
    await expect(page.locator('[data-testid="chat-message"]').last()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="chat-message"]').last()).toContainText('analyse');
  });
});
