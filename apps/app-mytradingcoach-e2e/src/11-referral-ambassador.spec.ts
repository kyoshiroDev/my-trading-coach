/**
 * PROMPT-175 — Parcours de parrainage ambassadeur, de bout en bout.
 *
 * Chaîne testée : inscription du filleul via le code de l'ambassadeur → checkout
 * Stripe → paiement → webhook → commission de 20 % créditée à l'ambassadeur.
 *
 * ⚠️ Ce test a besoin d'une API lancée, d'une base joignable et de clés Stripe de
 *    TEST. Il se SKIP proprement (avec la raison) si l'environnement manque, plutôt
 *    que d'échouer en rouge sur un problème d'infra. Voir README.md du projet e2e.
 *
 * Deux modes, via `E2E_STRIPE_MODE` (le mode utilisé est loggé au début du test) :
 *   - `webhook` (défaut) : rejoue un `invoice.payment_succeeded` signé. Déterministe.
 *   - `ui`               : pilote la vraie page Stripe Checkout. Exige `stripe listen`.
 *
 * Ce que le test NE fait pas : modifier la logique de commission. S'il échoue sur
 * le montant, c'est un bug produit à traiter séparément, pas un test à ajuster.
 */
import { expect, test } from '@playwright/test';
import {
  API_URL,
  Ambassador,
  cleanup,
  closeDb,
  createAmbassador,
  createCheckout,
  db,
  filleulEmail,
  getAmbassadorStats,
  loginUser,
  TEST_PASSWORD,
  uniqueSuffix,
  waitForCommission,
} from './helpers/referral.helper';
import {
  assertStripeTestMode,
  payOnHostedCheckout,
  sendSignedInvoicePaid,
  stripeMode,
} from './helpers/stripe-checkout.helper';

const MODE = stripeMode();
const COMMISSION_RATE = 0.2;

/** Montant facturé simulé en mode webhook : 49 € → commission attendue 9,80 €. */
const AMOUNT_PAID_EUR = 49;
const AMOUNT_PAID_CENTS = AMOUNT_PAID_EUR * 100;

/** Prérequis d'infra. Absents → skip explicite, jamais un faux rouge. */
function missingRequirement(): string | null {
  if (!process.env['DATABASE_URL']) return 'DATABASE_URL absente';
  if (!process.env['STRIPE_SECRET_KEY']) return 'STRIPE_SECRET_KEY absente';
  // Le webhook n'écrit rien lui-même : il enqueue dans BullMQ, et c'est le
  // StripeProcessor qui crée la commission. Sans Redis, le test attendrait pour rien.
  // L'API lit REDIS_HOST/REDIS_PORT (cf. BullModule) ; REDIS_URL n'est qu'une
  // commodité locale — accepter les deux, sinon le job CI skipperait à tort.
  if (!process.env['REDIS_URL'] && !process.env['REDIS_HOST']) {
    return 'REDIS_URL/REDIS_HOST absente (worker BullMQ requis)';
  }
  if (MODE === 'webhook' && !process.env['STRIPE_WEBHOOK_SECRET']) {
    return 'STRIPE_WEBHOOK_SECRET absente (nécessaire pour signer l\'événement)';
  }
  return null;
}

test.describe('Parrainage ambassadeur : lien → paiement → commission 20 %', () => {
  const suffix = uniqueSuffix();
  let ambassador: Ambassador;

  test.beforeAll(async () => {
    const missing = missingRequirement();
    test.skip(
      !!missing,
      `Environnement e2e paiement incomplet : ${missing}. Voir apps/app-mytradingcoach-e2e/README.md`,
    );
    assertStripeTestMode();
    ambassador = await createAmbassador(suffix);
  });

  test.afterAll(async () => {
    await cleanup(suffix).catch(() => undefined);
    await closeDb();
  });

  // Chaîne complète : le paiement met plusieurs secondes, l'attente du webhook aussi.
  test.setTimeout(180_000);

  test('le filleul paie, l\'ambassadeur touche 20 % du montant payé', async ({ page }) => {
    console.log(`[parrainage] mode Stripe = ${MODE}`);

    // ── 1. Le filleul s'inscrit via le lien de parrainage ──────────────────────
    // La landing envoie `?ref=CODE` sur /register ; le composant le lit, le
    // persiste et le transmet à `register` en MAJUSCULES.
    const email = filleulEmail(suffix);

    await page.goto(`/register?ref=${ambassador.referralCode}`);
    await expect(
      page.locator('[data-testid="register-email"]'),
      'Page /register inaccessible : l\'app tourne-t-elle sur BASE_URL ?',
    ).toBeVisible();

    await page.fill('[data-testid="register-email"]', email);
    await page.fill('[data-testid="register-password"]', TEST_PASSWORD);
    await page.fill('[data-testid="register-confirm"]', TEST_PASSWORD);
    await page.click('[data-testid="register-submit"]');

    // L'inscription aboutit (dashboard ou wizard d'onboarding selon l'état).
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });

    // ── 2. Le lien filleul → ambassadeur est bien en base ──────────────────────
    const filleul = await db().user.findUnique({
      where: { email },
      select: { id: true, referredBy: true, plan: true },
    });
    expect(filleul, 'Filleul introuvable après inscription').toBeTruthy();
    expect(
      filleul!.referredBy,
      'referredBy non renseigné : le code de parrainage n\'a pas été transmis par /register?ref=',
    ).toBe(ambassador.referralCode);

    // ── 3. Checkout Premium mensuel ────────────────────────────────────────────
    // Passe par l'API pour récupérer l'URL : c'est aussi ce qui crée et attache le
    // stripeCustomerId au filleul, sans lequel processReferral ne le retrouve pas.
    const token = await loginUser(email);
    const { data: checkout } = await createCheckout(token, 'premium_monthly');
    expect(checkout.url, 'Pas d\'URL de checkout Stripe renvoyée').toContain('checkout.stripe.com');

    const withCustomer = await db().user.findUnique({
      where: { email },
      select: { stripeCustomerId: true },
    });
    expect(
      withCustomer?.stripeCustomerId,
      'stripeCustomerId non attaché au filleul : processReferral ne pourra pas le retrouver',
    ).toBeTruthy();

    // ── 4. Paiement ────────────────────────────────────────────────────────────
    let expectedAmountPaid: number;

    if (MODE === 'ui') {
      // Parcours réel : Chrome remplit la carte de test sur la page Stripe hébergée.
      await page.goto(checkout.url);
      await payOnHostedCheckout(page);
      await page.waitForURL(/checkout=success/, { timeout: 60_000 });

      // Le montant réellement facturé fait foi (coupon parrainage éventuel, proratas).
      expectedAmountPaid = await waitForInvoiceAmount(withCustomer!.stripeCustomerId!);
    } else {
      // Parcours déterministe : on rejoue l'événement qui déclenche la commission.
      // C'est `invoice.payment_succeeded` (et non checkout.session.completed) qui
      // appelle processReferral — cf. stripe.service.ts.
      const res = await sendSignedInvoicePaid({
        apiUrl: API_URL,
        webhookSecret: process.env['STRIPE_WEBHOOK_SECRET']!,
        stripeCustomerId: withCustomer!.stripeCustomerId!,
        subscriptionId: `sub_e2e_${suffix}`,
        amountPaidCents: AMOUNT_PAID_CENTS,
      });
      // NestJS renvoie 201 par défaut sur un @Post : on accepte tout 2xx.
      expect(
        res.status,
        `Webhook refusé (${res.status}) : signature invalide ? STRIPE_WEBHOOK_SECRET ` +
          `de l'API et celui du test doivent être identiques. Corps : ${res.body.slice(0, 200)}`,
      ).toBeGreaterThanOrEqual(200);
      expect(res.status, `Webhook refusé (${res.status}) : ${res.body.slice(0, 200)}`).toBeLessThan(300);
      expectedAmountPaid = AMOUNT_PAID_EUR;
    }

    // ── 5. Attente de la commission (polling, pas de sleep) ────────────────────
    const commission = await waitForCommission({
      ambassadorId: ambassador.id,
      mode: MODE,
    });

    // ── 6. Assertions : le cœur du test ────────────────────────────────────────
    const expected = +(expectedAmountPaid * COMMISSION_RATE).toFixed(2);

    expect(
      commission.referredUserId,
      'La commission n\'est pas rattachée à ce filleul',
    ).toBe(filleul!.id);

    expect(
      commission.amount,
      `Commission attendue ${expected} € (20 % de ${expectedAmountPaid} €), reçue ${commission.amount} €`,
    ).toBeCloseTo(expected, 2);

    expect(commission.status, 'Une commission fraîche doit être « pending »').toBe('pending');

    // Règle de coexistence (PROMPT-176) : le rôle du parrain décide. Un AMBASSADOR
    // touche la commission cash et JAMAIS le mois offert du parrainage grand public.
    const reward = await db().referralReward.findFirst({
      where: { parrainId: ambassador.id },
    });
    expect(
      reward,
      'Un ambassadeur ne doit jamais recevoir de mois offert (ReferralReward)',
    ).toBeNull();

    // Restitution côté ambassadeur, via sa propre API.
    const { data: stats } = await getAmbassadorStats(ambassador.token);
    expect(stats.totalEarned, 'totalEarned ne reflète pas la commission').toBeCloseTo(expected, 2);
    expect(stats.pendingPayout, 'pendingPayout ne reflète pas la commission').toBeCloseTo(expected, 2);
    expect(stats.total, 'Le filleul doit apparaître dans les filleuls de l\'ambassadeur').toBeGreaterThanOrEqual(1);

    // Le filleul est bien passé PREMIUM.
    // En mode webhook on ne simule que l'invoice : le passage de plan vient de
    // syncSubscription, qui a besoin d'une vraie subscription Stripe. On ne
    // l'assert donc qu'en mode UI, où l'abonnement existe réellement.
    if (MODE === 'ui') {
      const after = await db().user.findUnique({
        where: { email },
        select: { plan: true },
      });
      expect(after?.plan, 'Le filleul devrait être PREMIUM après paiement').toBe('PREMIUM');
    }
  });
});

/**
 * Mode UI : récupère le montant réellement payé, pour asserter les 20 % sur le
 * vrai montant plutôt que sur une constante (un coupon parrainage peut s'appliquer).
 */
async function waitForInvoiceAmount(stripeCustomerId: string): Promise<number> {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env['STRIPE_SECRET_KEY']!);
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 1 });
    const paid = invoices.data[0];
    if (paid?.amount_paid) return paid.amount_paid / 100;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(
    `Aucune facture payée trouvée pour ${stripeCustomerId} : le paiement sur la page ` +
      'Stripe hébergée a-t-il abouti ?',
  );
}
