import { test, expect } from '@playwright/test';
import { TEST_USER_FREE, loginUser, logoutUser } from './helpers/auth';

test.describe('01 — Authentification', () => {

  test('register réussi → dashboard', async ({ page }) => {
    const uniqueEmail = `e2e-register-${Date.now()}@test.com`;
    await page.goto('/register');
    await page.fill('[data-testid="register-email"]', uniqueEmail);
    await page.fill('[data-testid="register-password"]', 'TestPassword123!');
    await page.fill('[data-testid="register-confirm"]', 'TestPassword123!');
    await page.click('[data-testid="register-submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('register email déjà utilisé → erreur 409', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="register-email"]', TEST_USER_FREE.email);
    await page.fill('[data-testid="register-password"]', TEST_USER_FREE.password);
    await page.fill('[data-testid="register-confirm"]', TEST_USER_FREE.password);
    await page.click('[data-testid="register-submit"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
  });

  test('login réussi → dashboard', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await expect(page).toHaveURL('/dashboard');
  });

  test('login mauvais mot de passe → erreur 401', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"]', TEST_USER_FREE.email);
    await page.fill('[data-testid="login-password"]', 'WrongPassword!');
    await page.click('[data-testid="login-submit"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
  });

  test('déconnexion → /login', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await logoutUser(page);
    await expect(page).toHaveURL('/login');
  });

  test('route protégée sans auth → redirect /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('persistance session après reload', async ({ page }) => {
    await loginUser(page, TEST_USER_FREE);
    await page.reload();
    await expect(page).toHaveURL('/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
  });
});
