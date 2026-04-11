import { test, expect } from '@playwright/test';

test('la page de connexion est accessible', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login/);
  expect(await page.locator('h1, h2').first().innerText()).toContain('Bon retour');
});
