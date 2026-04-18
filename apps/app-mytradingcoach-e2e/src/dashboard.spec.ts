import { test, expect } from '@playwright/test';
import { loginAs, FREE_USER, PREMIUM_USER } from './helpers/auth.helper';

test.describe('Dashboard — utilisateur FREE', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, FREE_USER.email, FREE_USER.password);
    await page.goto('/dashboard');
  });

  test('la page /dashboard est accessible après connexion', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('affiche le message de bienvenue avec le prénom', async ({ page }) => {
    await expect(page.locator('.greeting-title')).toBeVisible();
    await expect(page.locator('.greeting-title')).toContainText('Bonjour');
  });

  test('affiche les 4 stat cards', async ({ page }) => {
    await expect(page.locator('.stats-row')).toBeVisible();
    await expect(page.locator('.stat-card')).toHaveCount(4);
  });

  test('les stat cards contiennent les métriques principales', async ({ page }) => {
    const statsRow = page.locator('.stats-row');
    await expect(statsRow).toContainText('P&L Total');
    await expect(statsRow).toContainText('Win Rate');
    await expect(statsRow).toContainText('Drawdown Max');
    await expect(statsRow).toContainText('Trades');
  });

  test('la bannière premium est visible pour FREE', async ({ page }) => {
    await expect(page.locator('.premium-banner')).toBeVisible();
    await expect(page.locator('.premium-banner')).toContainText('39€');
    await expect(page.locator('.premium-banner')).toContainText('7 jours gratuits');
  });

  test('le bouton "Essayer gratuitement" est présent', async ({ page }) => {
    await expect(page.locator('.premium-banner-btn')).toBeVisible();
  });

  test('la section "Derniers trades" est présente', async ({ page }) => {
    await expect(page.locator('.recent-trades-card')).toBeVisible();
  });

  test('le message "Courbe disponible en Premium" s\'affiche pour FREE', async ({ page }) => {
    await expect(page.locator('.empty-chart')).toBeVisible();
    await expect(page.locator('.empty-chart')).toContainText('Premium');
  });

  test('le bouton topbar "Ajouter trade" ouvre le formulaire', async ({ page }) => {
    const addBtn = page.locator('button:has-text("Ajouter trade")');
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    await expect(page.locator('form')).toBeVisible();
  });

  test('pas d\'erreur 500 au chargement', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('text=/500|Internal Server Error/i')).not.toBeVisible();
  });
});

test.describe('Dashboard — utilisateur PREMIUM', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, PREMIUM_USER.email, PREMIUM_USER.password);
    await page.goto('/dashboard');
  });

  test('pas de bannière upsell pour PREMIUM', async ({ page }) => {
    await expect(page.locator('.premium-banner')).not.toBeVisible();
  });

  test('la courbe equity est rendue via canvas', async ({ page }) => {
    await expect(page.locator('.empty-chart')).not.toBeVisible();
    await expect(page.locator('canvas')).toBeAttached();
  });

  test('affiche les 4 stat cards sans skeleton', async ({ page }) => {
    await expect(page.locator('.stat-skeleton')).toHaveCount(0);
    await expect(page.locator('.stat-card')).toHaveCount(4);
  });
});
