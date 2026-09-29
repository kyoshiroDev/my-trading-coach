/**
 * Parcours 2 : Import CSV Tradovate (là où le bug de Val est apparu).
 *
 * Utilise les VRAIES fixtures (`tradovate-performance.csv` + `tradovate-cash-history.csv`,
 * partagées avec `csv-import.service.spec.ts` côté API) plutôt qu'un faux fichier :
 * 20 trades, 3 fills partagés, total de frais exact déjà prouvé à 21,84 $ côté
 * unitaire — ce test vérifie que ce même total ressort du VRAI tunnel HTTP
 * (upload multipart → parsing → persistance → agrégat du journal).
 *
 * Piloté via le wizard d'onboarding (`onboarding-choice-csv`), comme le
 * parcours réel de Val. Note d'implémentation : la modale d'import se ferme
 * dès que l'événement `imported` est émis (le wizard enchaîne directement sur
 * l'écran final) — l'écran de résultat du composant n'est donc jamais visible
 * ici. Les assertions portent sur l'état final dans le journal, ce qui est de
 * toute façon plus probant qu'un texte de confirmation dans une modale.
 *
 * ⚠️ La régression « setupId périmé » (bug Val) est couverte séparément, en
 * intégration : `apps/api-mytradingcoach/src/modules/trades/csv-import-setup-fallback.int-spec.ts`.
 * Ce test-ci n'envoie jamais de setupId invalide — il ne fait qu'exercer le
 * chemin nominal d'import Tradovate avec frais.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { closeDb, cleanupUser, completeOnboardingUpToTradeChoice, uniqueEmail } from './helpers/onboarding.helper';

const FIXTURES_DIR = join(
  __dirname,
  '../../api-mytradingcoach/src/modules/trades/__fixtures__',
);
const PERFORMANCE_CSV = join(FIXTURES_DIR, 'tradovate-performance.csv');
const CASH_HISTORY_CSV = join(FIXTURES_DIR, 'tradovate-cash-history.csv');

// Valeurs déjà prouvées par csv-import.service.spec.ts sur les mêmes fixtures :
// 20 trades, total de commissions 21,84 $ après dédup des fills partagés.
const EXPECTED_TRADES = 20;
const EXPECTED_FEES = 21.84;

test.afterAll(() => closeDb());

test('Import Tradovate (Performance + Cash history) : trades + frais exacts', async ({ page }) => {
  const email = uniqueEmail('import-tradovate');

  try {
    await completeOnboardingUpToTradeChoice(page, email);

    await page.click('[data-testid="onboarding-choice-csv"]');
    await expect(page.locator('[data-testid="csv-import-modal"]')).toBeVisible();

    // Tradovate est la source présélectionnée en onboarding : les deux champs
    // fichier (Performance requis, Cash history optionnel) sont déjà affichés.
    await page.setInputFiles('[data-testid="import-trades-input"]', PERFORMANCE_CSV);
    await page.setInputFiles('[data-testid="import-fees-input"]', CASH_HISTORY_CSV);

    await expect(page.locator('[data-testid="import-submit"]')).toBeEnabled();
    await page.click('[data-testid="import-submit"]');

    // L'import réussi enchaîne directement sur l'écran final du wizard.
    await expect(page.locator('[data-testid="onboarding-dashboard"]')).toBeVisible({ timeout: 20_000 });
    await page.click('[data-testid="onboarding-dashboard"]');
    await expect(page.locator('[data-testid="onboarding-wizard"]')).toHaveCount(0);

    await page.goto('/journal');

    await expect(
      page.locator('[data-testid="period-trades-count"]'),
      `${EXPECTED_TRADES} trades attendus depuis Performance.csv`,
    ).toHaveText(String(EXPECTED_TRADES), { timeout: 15_000 });

    // Locale fr-FR (pipe `number` Angular) : virgule décimale, ex. "-$21,84".
    const feesText = await page.locator('[data-testid="period-fees"]').innerText();
    const fees = Math.abs(parseFloat(feesText.replace(/[^0-9,-]/g, '').replace(',', '.')));
    expect(fees, `Frais attendus ${EXPECTED_FEES} $ (dédup des fills partagés), lu "${feesText}"`).toBeCloseTo(
      EXPECTED_FEES,
      2,
    );

    // Le cœur de la régression Val côté produit : les frais du Cash history sont
    // bien déduits, donc P&L net ≠ P&L brut (net = brut - frais). Un import qui
    // ignorerait le fichier de frais donnerait net == brut ici.
    expect(fees, 'Frais nuls : le Cash history ne modifie pas le P&L net (régression fusion Tradovate)').toBeGreaterThan(0);
  } finally {
    await cleanupUser(email);
  }
});