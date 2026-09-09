/**
 * Helper partagé entre 12-activation et 13-import-tradovate : les deux
 * pilotent le même wizard d'onboarding jusqu'à l'étape 8 (choix du premier
 * trade), seule la suite diverge (saisie manuelle vs import CSV).
 */
import { Page, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const TEST_PASSWORD = 'TestPassword123!';

export function uniqueEmail(tag: string): string {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  return `e2e-${tag}-${suffix}@test.local`;
}

export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await expect(page.locator('[data-testid="register-email"]')).toBeVisible();
  await page.fill('[data-testid="register-email"]', email);
  await page.fill('[data-testid="register-password"]', TEST_PASSWORD);
  await page.fill('[data-testid="register-confirm"]', TEST_PASSWORD);
  await page.click('[data-testid="register-submit"]');
  await page.waitForURL('**/dashboard');
  await expect(page.locator('[data-testid="onboarding-wizard"]')).toBeVisible();
}

/**
 * Déclaration de compte de l'étape 4 (« Ton compte de trading »).
 *
 * Par défaut PERSO — c'est le mode initial du wizard, et le seul que traversaient
 * les parcours existants. `PROPFIRM` ouvre le bloc de règles (firm, objectif,
 * drawdown), tous optionnels côté produit : on peut donc n'en renseigner qu'une
 * partie, et les tests s'en servent pour vérifier que le payload n'envoie que les
 * champs réellement saisis.
 */
export interface DeclarationCompte {
  mode?: 'PERSO' | 'PROPFIRM';
  capital?: string;
  broker?: string;
  profitTarget?: string;
  maxDrawdown?: string;
  drawdownType?: 'TRAILING' | 'STATIC';
}

/** Étapes 1 à 4 (Promesse → Marché → Objectif → Compte), communes à tout parcours. */
export async function goThroughIntro(page: Page, compte: DeclarationCompte = {}): Promise<void> {
  await page.click('[data-testid="onboarding-start"]');

  await page.click('[data-testid="onboarding-market-CRYPTO"]');
  await page.click('[data-testid="market-continue"]');

  await page.click('[data-testid="onboarding-goal-DISCIPLINE"]');
  await page.click('[data-testid="goal-continue"]');

  const prop = compte.mode === 'PROPFIRM';
  if (prop) {
    await page.click('[data-testid="account-mode-propfirm"]');
    // Le bloc de règles n'existe dans le DOM que dans ce mode : l'attendre évite
    // un remplissage sur un champ pas encore rendu.
    await expect(page.locator('[data-testid="account-broker"]')).toBeVisible();
  }

  await page.fill('[data-testid="capital-input"]', compte.capital ?? '5000');

  if (prop) {
    if (compte.broker !== undefined) {
      await page.fill('[data-testid="account-broker"]', compte.broker);
    }
    if (compte.profitTarget !== undefined) {
      await page.fill('[data-testid="account-profit-target"]', compte.profitTarget);
    }
    if (compte.maxDrawdown !== undefined) {
      await page.fill('[data-testid="account-max-drawdown"]', compte.maxDrawdown);
    }
    if (compte.drawdownType === 'STATIC') {
      await page.click('[data-testid="drawdown-static"]');
    }
  }

  await page.click('[data-testid="capital-continue"]');
}

/**
 * Étape 5 (Stratégie) puis franchissement du checkpoint : le clic sur
 * « Continuer » y enregistre le profil IA ET crée le compte de trading déclaré à
 * l'étape 4. On attend l'étape Actifs pour ne pas enchaîner sur un écran encore
 * en cours d'enregistrement.
 */
export async function crossProfileCheckpoint(page: Page): Promise<void> {
  await page.click('[data-testid="onboarding-style-SCALPING"]');
  await page.fill(
    '[data-testid="strategy-description"]',
    'Je scalpe le NQ sur la session de Londres, 3 trades max par jour.',
  );
  await page.click('[data-testid="onboarding-session-LONDON"]');
  await page.click('[data-testid="strategy-continue"]');

  await expect(
    page.locator('[data-testid="onboarding-asset-search"]'),
    "Le checkpoint de l'étape 5 n'a pas abouti : ni profil enregistré, ni compte créé",
  ).toBeVisible({ timeout: 15_000 });
}

/** Étapes 5 à 7 (Stratégie → Actifs → Setups), obligatoires avant le premier trade. */
export async function goThroughProfile(page: Page): Promise<void> {
  await crossProfileCheckpoint(page);

  await page.fill('[data-testid="onboarding-asset-search"]', 'BTC/USDT');
  await page.click('[data-testid="onboarding-asset-add"]');
  await page.click('[data-testid="assets-continue"]');

  // Setups par défaut déjà seedés à l'inscription : rien à retirer/ajouter ici.
  await page.click('[data-testid="setups-continue"]');
}

/** Enchaîne les étapes 1-7 : place le wizard sur l'écran « Ajoute ton premier trade ». */
export async function completeOnboardingUpToTradeChoice(
  page: Page,
  email: string,
  compte: DeclarationCompte = {},
): Promise<void> {
  await register(page, email);
  await goThroughIntro(page, compte);
  await goThroughProfile(page);
}

// ── Nettoyage ─────────────────────────────────────────────────────────────────
// Chaque test crée un vrai utilisateur via /register (email unique par run) :
// on le supprime en fin de test pour ne pas accumuler des comptes dans la base
// de dev/CI d'une exécution à l'autre. Client construit comme celui de l'API
// (driver adapter PrismaPg sur un pool pg) : un `new PrismaClient()` nu échoue
// en Prisma 7, cf. helpers/referral.helper.ts.

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

function db(): PrismaClient {
  if (!prisma) {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 5 });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({
      adapter,
    } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return prisma;
}

/** Supprime l'utilisateur (trades/setups/comptes cascadent via onDelete: Cascade). */
export async function cleanupUser(email: string): Promise<void> {
  await db().user.deleteMany({ where: { email } }).catch(() => undefined);
}

/**
 * Comptes de trading de l'utilisateur, lus en base.
 *
 * Pourquoi la base plutôt que l'écran « Mes comptes » : ce qu'on veut prouver ici,
 * c'est le PAYLOAD envoyé au checkpoint (type, règles, champs volontairement
 * absents). L'écran met en forme, arrondit et masque les règles nulles — il ne
 * distingue pas un `profitTarget` absent d'un `profitTarget` à 0. La base, si.
 */
export async function accountsOf(email: string) {
  return db().tradingAccount.findMany({
    where: { user: { email } },
    orderBy: { createdAt: 'asc' },
    select: {
      label: true,
      broker: true,
      type: true,
      accountSize: true,
      startingBalance: true,
      currency: true,
      profitTarget: true,
      maxDrawdown: true,
      drawdownType: true,
    },
  });
}

export async function closeDb(): Promise<void> {
  await prisma?.$disconnect();
  await pool?.end();
  prisma = null;
  pool = null;
}
