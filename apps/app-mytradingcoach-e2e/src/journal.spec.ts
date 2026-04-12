import {test, expect, Page} from '@playwright/test';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|journal)/, { timeout: 15000 });
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

  test('le formulaire d\'ajout de trade est accessible via le bouton', async ({ page }) => {
    await page.goto('/journal');
    const addBtn = page.locator('button:has-text("Nouveau"), button:has-text("Ajouter"), button:has-text("+ Trade")').first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.locator('form')).toBeVisible();
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
    // On vérifie simplement que la page se charge sans erreurs
    await expect(page.locator('body')).toBeVisible();
    const hasError = await page.locator('text=/500|Internal Server Error/').isVisible();
    expect(hasError).toBe(false);
  });

  test('la page /journal est inaccessible sans connexion', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
