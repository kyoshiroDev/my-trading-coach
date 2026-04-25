import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, loginUser } from './helpers/auth';

test.describe('06 — Navigation', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
  });

  test('sidebar — lien Journal navigue vers /journal', async ({ page }) => {
    await page.click('[data-testid="nav-journal"]');
    await expect(page).toHaveURL('/journal');
  });

  test('sidebar — lien Analytics navigue vers /analytics', async ({ page }) => {
    await page.click('[data-testid="nav-analytics"]');
    await expect(page).toHaveURL('/analytics');
  });

  test('sidebar — lien Dashboard navigue vers /dashboard', async ({ page }) => {
    await page.goto('/journal');
    await page.click('[data-testid="nav-dashboard"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('sidebar — lien Settings navigue vers /settings', async ({ page }) => {
    await page.click('[data-testid="nav-settings"]');
    await expect(page).toHaveURL('/settings');
  });

  test('topbar — titre de page correct sur dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.page-title')).toContainText('Dashboard');
  });

  test('topbar — titre de page correct sur journal', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.locator('.page-title')).toContainText('Journal');
  });

  test('topbar — titre de page correct sur analytics', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('.page-title')).toContainText('Analytics');
  });

  test('404 → page not found visible', async ({ page }) => {
    await page.goto('/cette-page-nexiste-pas');
    await expect(page.locator('body')).toContainText(/404|introuvable|not found/i);
  });
});
