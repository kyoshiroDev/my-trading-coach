/**
 * PROMPT-181 — Parcours 1 : Activation (inscription → premier trade).
 *
 * Le funnel n°1 du produit : un bug ici tue l'acquisition en silence, sans
 * qu'aucune métrique ne le signale directement (juste un taux d'activation qui
 * baisse, difficile à relier à une régression précise). D'où le e2e dédié.
 *
 * Parcours couverts :
 *   - nominal : inscription → wizard (marché/objectif/compte/stratégie/actifs/
 *     setups) → premier trade saisi manuellement → visible dans le journal.
 *   - skip : inscription → « Je commence à zéro » → dashboard fonctionnel,
 *     sans trade, sans écran cassé.
 *   - prop firm (PROMPT-199) : l'étape 4 déclare un compte d'évaluation avec ses
 *     règles, créé au checkpoint de l'étape 5. Cette branche n'était pas couverte :
 *     les deux parcours ci-dessus ne traversent l'étape 4 qu'en mode PERSO, donc
 *     ni le bloc de règles, ni le payload EVALUATION, ni la garde anti-doublon.
 *
 * Email unique par run (timestamp + aléatoire) : idempotent, aucune donnée à
 * pré-nettoyer, chaque exécution crée son propre utilisateur.
 */
import { test, expect } from '@playwright/test';
import {
  accountsOf,
  cleanupUser,
  closeDb,
  completeOnboardingUpToTradeChoice,
  crossProfileCheckpoint,
  goThroughIntro,
  register,
  uniqueEmail,
} from './helpers/onboarding.helper';

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

/**
 * PROMPT-199 — étape 4 en mode prop firm.
 *
 * Avant ce checkpoint, le compte n'était créé qu'au premier trade par
 * `ensureDefaultAccountId` : toujours PERSONAL, libellé « Compte principal », sans
 * broker ni règles. Un trader prop firm démarrait sur un compte faux, et rien ne
 * l'en avertissait. Ces tests vérifient donc ce que le back a REÇU, pas ce que
 * l'écran affiche.
 */
test.describe('Activation : déclaration prop firm à l\'étape 4', () => {
  test.afterAll(() => closeDb());

  test('règles complètes → compte EVALUATION créé au checkpoint, visible dans « Mes comptes »', async ({ page }) => {
    const email = uniqueEmail('activation-propfirm');

    try {
      await register(page, email);
      await goThroughIntro(page, {
        mode: 'PROPFIRM',
        capital: '50000',
        broker: 'Apex',
        profitTarget: '3000',
        maxDrawdown: '2500',
        drawdownType: 'STATIC',
      });

      // Rien n'est créé avant le checkpoint : l'étape 4 ne fait que déclarer.
      expect(
        await accountsOf(email),
        'Un compte a été créé dès l\'étape 4 : la déclaration doit rester sans effet jusqu\'au checkpoint',
      ).toHaveLength(0);

      await crossProfileCheckpoint(page);

      await expect
        .poll(async () => (await accountsOf(email)).length, { timeout: 15_000 })
        .toBe(1);

      const [compte] = await accountsOf(email);
      expect(compte.type, 'Compte PERSONAL générique : les règles prop firm sont perdues').toBe('EVALUATION');
      expect(compte.label, 'Le libellé doit reprendre la firm saisie').toBe('Apex #1');
      expect(compte.broker).toBe('Apex');
      expect(compte.accountSize).toBe(50_000);
      expect(compte.startingBalance).toBe(50_000);
      expect(compte.profitTarget).toBe(3_000);
      expect(compte.maxDrawdown).toBe(2_500);
      expect(compte.drawdownType, 'Le type choisi à l\'étape 4 n\'est pas transmis').toBe('STATIC');

      // Et l'utilisateur le retrouve bien dans son espace.
      await page.goto('/accounts');
      const carte = page.locator('.acct-card', { hasText: 'Apex #1' });
      await expect(carte).toBeVisible({ timeout: 15_000 });
      await expect(carte).toContainText('Apex');
    } finally {
      await cleanupUser(email);
    }
  });

  test('règles laissées vides → compte EVALUATION sans objectif ni drawdown', async ({ page }) => {
    // Tout le bloc prop firm est optionnel. Envoyer 0 au lieu de rien afficherait une
    // barre d'objectif vide dans « Mes comptes » : l'absence doit rester une absence.
    const email = uniqueEmail('activation-propfirm-vide');

    try {
      await register(page, email);
      await goThroughIntro(page, { mode: 'PROPFIRM', capital: '25000' });
      await crossProfileCheckpoint(page);

      await expect
        .poll(async () => (await accountsOf(email)).length, { timeout: 15_000 })
        .toBe(1);

      const [compte] = await accountsOf(email);
      expect(compte.type).toBe('EVALUATION');
      expect(compte.label, 'Sans firm saisie, on retombe sur le libellé neutre').toBe('Compte principal');
      expect(compte.broker).toBeNull();
      expect(compte.accountSize).toBe(25_000);
      expect(compte.profitTarget, 'Un objectif à 0 affiche une barre vide au lieu de masquer la carte').toBeNull();
      expect(compte.maxDrawdown).toBeNull();
    } finally {
      await cleanupUser(email);
    }
  });

  test('mode PERSO → compte PERSONAL sans règles (non-régression)', async ({ page }) => {
    const email = uniqueEmail('activation-perso');

    try {
      await register(page, email);
      await goThroughIntro(page, { capital: '5000' });
      await crossProfileCheckpoint(page);

      await expect
        .poll(async () => (await accountsOf(email)).length, { timeout: 15_000 })
        .toBe(1);

      const [compte] = await accountsOf(email);
      expect(compte.type).toBe('PERSONAL');
      expect(compte.label).toBe('Compte principal');
      expect(compte.broker).toBeNull();
      expect(compte.accountSize).toBe(5_000);
      expect(compte.profitTarget).toBeNull();
      expect(compte.maxDrawdown).toBeNull();
    } finally {
      await cleanupUser(email);
    }
  });

  test('retour arrière puis re-franchissement → aucune seconde création', async ({ page }) => {
    // Le drapeau mémoire du composant ne survit pas à un rechargement : ce qui empêche
    // le doublon, c'est la vérification serveur (« zéro compte ? alors seulement je
    // crée »). On recharge donc EXPRÈS avant de repasser le checkpoint, sinon le test
    // passerait même sans cette vérification.
    //
    // On compte les POST plutôt que les lignes en base : une création refusée par une
    // contrainte laisserait la base à 1 compte tout en prouvant que la garde a sauté.
    // Le POST est le fait observable, la ligne n'en est que la conséquence.
    const email = uniqueEmail('activation-propfirm-doublon');
    const estRouteComptes = (url: string) => new URL(url).pathname.endsWith('/accounts');
    const creations: string[] = [];
    page.on('request', (req) => {
      if (estRouteComptes(req.url()) && req.method() === 'POST') creations.push(req.url());
    });

    try {
      await register(page, email);
      await goThroughIntro(page, { mode: 'PROPFIRM', capital: '50000', broker: 'Apex' });
      await crossProfileCheckpoint(page);

      await expect
        .poll(async () => (await accountsOf(email)).length, { timeout: 10_000 })
        .toBe(1);
      expect(creations, 'Le premier franchissement doit créer exactement un compte').toHaveLength(1);

      // Le wizard reprend où il s'était arrêté (progression en stockage local),
      // drapeau anti-doublon remis à zéro.
      await page.reload();
      await expect(page.locator('[data-testid="onboarding-asset-search"]')).toBeVisible({ timeout: 10_000 });

      await page.click('[data-testid="onboarding-back"]');
      await expect(page.locator('[data-testid="strategy-continue"]')).toBeVisible();

      // La garde est ASYNCHRONE : elle relit la liste des comptes et ne déciderait de
      // créer qu'ENSUITE. On arme l'attente de cette relecture AVANT le clic, sinon sa
      // réponse peut arriver pendant qu'on s'apprête à l'attendre.
      const relecture = page.waitForResponse(
        (r) => estRouteComptes(r.url()) && r.request().method() === 'GET',
        { timeout: 10_000 },
      );
      await page.click('[data-testid="strategy-continue"]');
      await expect(page.locator('[data-testid="onboarding-asset-search"]')).toBeVisible({ timeout: 10_000 });
      await relecture;

      // Prouver une ABSENCE demande une fenêtre bornée : on laisse au POST fautif le
      // temps de partir, et c'est le dépassement du délai qui vaut succès. Conclure
      // dès le retour de la relecture constaterait « pas de POST » simplement parce
      // qu'il n'a pas encore eu le temps d'être émis.
      const secondeCreation = await page
        .waitForRequest(
          (r) => estRouteComptes(r.url()) && r.method() === 'POST',
          { timeout: 3_000 },
        )
        .then(() => true)
        .catch(() => false);

      expect(
        secondeCreation,
        'Un second compte a été créé au re-franchissement du checkpoint',
      ).toBe(false);
      expect(creations).toHaveLength(1);

      const comptes = await accountsOf(email);
      expect(comptes).toHaveLength(1);
      expect(comptes[0].label).toBe('Apex #1');
    } finally {
      await cleanupUser(email);
    }
  });
});
