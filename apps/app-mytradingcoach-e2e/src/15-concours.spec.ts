/**
 * Tirage mensuel (PROMPT-tirage-mensuel, lot B) : l'entrée « Score trader » de la barre latérale
 * devient « Concours du mois » dès qu'un tirage est allumé, et redevient « Score trader » quand
 * tout est éteint. Connexion réelle (compte de test gratuit), état du tirage simulé
 * (`GET /api/giveaway/state`) : aucune donnée créée, rien à nettoyer.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginUser } from './helpers/auth';

function giveawayState(enabled: boolean) {
  return {
    enabled, free: enabled, premium: false, freePrizeMonths: 1, premiumPrizeMonths: 3, minTrades: 5,
    nextDrawAt: '2030-01-01T08:00:00.000Z', winnersFree: 0, winnersPremium: 0, monthsOffered: 0, winners: [],
    demo: false, me: { pool: 'FREE', reason: enabled ? 'need_trades' : 'pool_off', tradesThisMonth: 2 }, myWin: null,
  };
}

async function mockGiveaway(page: Page, enabled: boolean): Promise<void> {
  await page.route('**/api/giveaway/state', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: giveawayState(enabled) }) }),
  );
}

test.describe('Concours du mois : barre latérale', () => {
  test('tout éteint : « Score trader », pas d’onglet Concours', async ({ page }) => {
    await mockGiveaway(page, false);
    await loginUser(page);
    await expect(page.getByTestId('nav-scoring')).toBeVisible();
    await expect(page.getByTestId('nav-concours')).toHaveCount(0);
  });

  test('un tirage allumé : « Concours du mois » à la place, page avec le statut', async ({ page }) => {
    await mockGiveaway(page, true);
    await loginUser(page);
    await expect(page.getByTestId('nav-concours')).toBeVisible();
    await expect(page.getByTestId('nav-scoring')).toHaveCount(0);
    await page.getByTestId('nav-concours').click();
    await expect(page).toHaveURL(/\/concours$/);
    await expect(page.getByTestId('giveaway-status-text')).toContainText('Encore 3');
    await expect(page.getByTestId('giveaway-first-draw')).toBeVisible();
  });

  test('« Score trader » reste joignable par son URL quand le concours est allumé', async ({ page }) => {
    await mockGiveaway(page, true);
    await loginUser(page);
    await page.goto('/scoring');
    await expect(page).toHaveURL(/\/scoring$/);
  });
});
