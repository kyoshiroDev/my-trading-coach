import { test, expect } from '@playwright/test';

test.describe('Authentification', () => {
  test('redirect vers /login si non connecté', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirect vers /login depuis /analytics si non connecté', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirect vers /login depuis /journal si non connecté', async ({ page }) => {
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/login/);
  });

  test('la page /login est accessible sans authentification', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('form')).toBeVisible();
  });

  test('la page /register est accessible sans authentification', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator('form')).toBeVisible();
  });

  test('affiche un message d\'erreur pour des identifiants invalides', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'invalide@test.com');
    await page.fill('input[type="password"]', 'mauvais_mdp');
    await page.click('button[type="submit"]');

    // Attendre le message d'erreur
    await expect(page.locator('.error-message, [class*="error"], [role="alert"]')).toBeVisible({ timeout: 5000 });
  });
});
