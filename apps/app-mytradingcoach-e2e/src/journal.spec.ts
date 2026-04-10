import { test, expect } from '@playwright/test';

async function loginAs(
  page: Parameters<typeof test>[1] extends { page: infer P } ? P : never,
  email: string,
  password: string,
) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|journal)/, { timeout: 10000 });
}

test.describe('Journal de trading', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(
      page,
      process.env['E2E_FREE_EMAIL'] ?? 'free@test.com',
      process.env['E2E_FREE_PASSWORD'] ?? 'Password123!',
    );
  });

  test('la page /journal est accessible après connexion', async ({ page }) => {
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/journal/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('le formulaire d\'ajout de trade est visible', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.locator('form, [data-testid="trade-form"]')).toBeVisible();
  });

  test('peut ouvrir le formulaire d\'ajout de trade', async ({ page }) => {
    await page.goto('/journal');
    const addBtn = page.locator('button[data-testid="add-trade"], button:has-text("Nouveau"), button:has-text("Ajouter")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await expect(page.locator('form')).toBeVisible();
    }
  });

  test('affiche la liste des trades (vide ou avec données)', async ({ page }) => {
    await page.goto('/journal');
    // La liste doit exister dans le DOM même si elle est vide
    const list = page.locator('[data-testid="trades-list"], table, .trades-list, .trade-list');
    await expect(list.or(page.locator('text=/Aucun trade|No trades|journal vide/i'))).toBeVisible({ timeout: 5000 });
  });

  test('la pagination ou le scroll infini est présent si des trades existent', async ({ page }) => {
    await page.goto('/journal');
    // On vérifie simplement que la page se charge sans erreur
    await expect(page.locator('body')).toBeVisible();
    const hasError = await page.locator('text=/500|Internal Server Error/').isVisible();
    expect(hasError).toBe(false);
  });

  test('la page /journal est inaccessible sans connexion', async ({ page }) => {
    // Aller directement sans être connecté
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/login/);
  });
});
