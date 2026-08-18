/**
 * PROMPT-181 — Parcours 1 : Activation (inscription → premier trade).
 *
 * Le funnel n°1 du produit : un bug ici tue l'acquisition en silence, sans
 * qu'aucune métrique ne le signale directement (juste un taux d'activation qui
 * baisse, difficile à relier à une régression précise). D'où le e2e dédié.
 *
 * Deux parcours couverts :
 *   - nominal : inscription → wizard (marché/objectif/capital/stratégie/actifs/
 *     setups) → premier trade saisi manuellement → visible dans le journal.
 *   - skip : inscription → « Je commence à zéro » → dashboard fonctionnel,
 *     sans trade, sans écran cassé.
 *
 * Email unique par run (timestamp + aléatoire) : idempotent, aucune donnée à
 * pré-nettoyer, chaque exécution crée son propre utilisateur.
 */
import { test, expect } from '@playwright/test';
import { closeDb, cleanupUser, completeOnboardingUpToTradeChoice, uniqueEmail } from './helpers/onboarding.helper';

test.describe('Activation : inscription → premier trade', () => {
  test.afterAll(() => closeDb());

  test('parcours nominal — saisie manuelle du premier trade → visible dans le journal', async ({ page }) => {
    const email = uniqueEmail('activation-manual');
    const asset = 'BTC/USDT';

    try {
      await completeOnboardingUpToTradeChoice(page, email);

      await page.click('[data-testid="onboarding-choice-manual"]');
      await expect(page.locator('[data-testid="trade-modal"]')).toBeVisible();

      await page.fill('[data-testid="trade-asset"]', asset);
      await page.click('[data-testid="trade-side-long"]');
      await page.fill('[data-testid="trade-entry"]', '50000');
      await page.click('[data-testid="trade-submit"]');

      // Retour à l'écran final du wizard, puis accès au dashboard.
      await expect(page.locator('[data-testid="onboarding-dashboard"]')).toBeVisible({ timeout: 15_000 });
      await page.click('[data-testid="onboarding-dashboard"]');
      await expect(page.locator('[data-testid="onboarding-wizard"]')).toHaveCount(0);

      // Le journal doit contenir CE trade précisément (pas juste « pas d'erreur »).
      await page.goto('/journal');
      const row = page.locator('[data-testid="trade-row"]', { hasText: asset });
      await expect(
        row,
        `Le trade ${asset} créé pendant l'onboarding n'apparaît pas dans le journal`,
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupUser(email);
    }
  });

  test('parcours skip — « je commence à zéro » → dashboard fonctionnel sans trade', async ({ page }) => {
    const email = uniqueEmail('activation-skip');

    try {
      await completeOnboardingUpToTradeChoice(page, email);

      await page.click('[data-testid="onboarding-choice-skip"]');
      await expect(page.locator('[data-testid="onboarding-dashboard"]')).toBeVisible({ timeout: 15_000 });
      await page.click('[data-testid="onboarding-dashboard"]');
      await expect(page.locator('[data-testid="onboarding-wizard"]')).toHaveCount(0);

      // Dashboard fonctionnel : le KPI capital s'affiche (pas d'écran cassé/vide).
      await expect(page.locator('[data-testid="dashboard-capital"]')).toBeVisible({ timeout: 15_000 });

      // Journal accessible et vide, sans erreur.
      await page.goto('/journal');
      await expect(page.locator('[data-testid="empty-state"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="trade-row"]')).toHaveCount(0);
    } finally {
      await cleanupUser(email);
    }
  });
});
