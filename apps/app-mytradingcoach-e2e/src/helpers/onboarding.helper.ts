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

/** Étapes 1 à 4 (Promesse → Marché → Objectif → Capital), communes à tout parcours. */
export async function goThroughIntro(page: Page): Promise<void> {
  await page.click('[data-testid="onboarding-start"]');

  await page.click('[data-testid="onboarding-market-CRYPTO"]');
  await page.click('[data-testid="market-continue"]');

  await page.click('[data-testid="onboarding-goal-DISCIPLINE"]');
  await page.click('[data-testid="goal-continue"]');

  await page.fill('[data-testid="capital-input"]', '5000');
  await page.click('[data-testid="capital-continue"]');
}

/** Étapes 5 à 7 (Stratégie → Actifs → Setups), obligatoires avant le premier trade. */
export async function goThroughProfile(page: Page): Promise<void> {
  await page.click('[data-testid="onboarding-style-SCALPING"]');
  await page.fill(
    '[data-testid="strategy-description"]',
    'Je scalpe le NQ sur la session de Londres, 3 trades max par jour.',
  );
  await page.click('[data-testid="onboarding-session-LONDON"]');
  await page.click('[data-testid="strategy-continue"]');

  await page.fill('[data-testid="onboarding-asset-search"]', 'BTC/USDT');
  await page.click('[data-testid="onboarding-asset-add"]');
  await page.click('[data-testid="assets-continue"]');

  // Setups par défaut déjà seedés à l'inscription : rien à retirer/ajouter ici.
  await page.click('[data-testid="setups-continue"]');
}

/** Enchaîne les étapes 1-7 : place le wizard sur l'écran « Ajoute ton premier trade ». */
export async function completeOnboardingUpToTradeChoice(page: Page, email: string): Promise<void> {
  await register(page, email);
  await goThroughIntro(page);
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

export async function closeDb(): Promise<void> {
  await prisma?.$disconnect();
  await pool?.end();
  prisma = null;
  pool = null;
}
