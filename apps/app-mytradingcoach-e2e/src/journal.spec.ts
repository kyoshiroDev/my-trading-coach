import { test, expect } from '@playwright/test';
import { loginAs, FREE_USER } from './helpers/auth.helper';

test.describe('Journal de trading', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FREE_USER.email, FREE_USER.password);
  });

  test('la page /journal est accessible après connexion', async ({ page }) => {
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/journal/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('le bouton "Nouveau trade" ouvre le formulaire', async ({ page }) => {
    await page.goto('/journal');
    const addBtn = page.locator('button:has-text("Nouveau trade")');
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.locator('form')).toBeVisible();
  });

  test('affiche la liste des trades ou l\'état vide', async ({ page }) => {
    await page.goto('/journal');
    const list = page.locator('table.journal-table, .empty-state');
    await expect(list).toBeVisible({ timeout: 5000 });
  });

  test('les filtres LONG/SHORT sont présents', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.locator('button.filter-chip:has-text("LONG")')).toBeVisible();
    await expect(page.locator('button.filter-chip:has-text("SHORT")')).toBeVisible();
  });

  test('la page /journal est inaccessible sans connexion', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('pas d\'erreur 500 au chargement', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=/500|Internal Server Error/i')).not.toBeVisible();
  });
});
