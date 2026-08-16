/**
 * Helpers Stripe pour les tests e2e de paiement.
 *
 * Deux modes, pilotés par `E2E_STRIPE_MODE` :
 *
 * - `ui`      : pilote la vraie page Stripe Checkout hébergée (Chrome remplit la
 *               carte de test dans les iframes Stripe). Le plus fidèle, mais les
 *               sélecteurs appartiennent à Stripe et peuvent bouger sans préavis.
 *               Nécessite `stripe listen` actif pour que le webhook revienne.
 * - `webhook` : (défaut) ne va pas jusqu'à la page Stripe, et rejoue à la place un
 *               événement `invoice.payment_succeeded` SIGNÉ directement sur
 *               l'endpoint webhook. Déterministe, pas de dépendance à l'UI Stripe
 *               ni à `stripe listen`. Teste la vraie logique de commission.
 *
 * ⚠️ L'événement qui déclenche la commission est `invoice.payment_succeeded`
 * (cf. `stripe.service.ts` → `processReferral`), PAS `checkout.session.completed`.
 * Un `stripe trigger invoice.payment_succeeded` ne convient pas non plus : il
 * fabrique un customer Stripe arbitraire, alors que `processReferral` retrouve le
 * filleul par son `stripeCustomerId`. D'où la forge manuelle ci-dessous.
 */
import { expect, FrameLocator, Page } from '@playwright/test';
import Stripe from 'stripe';

export type StripeMode = 'ui' | 'webhook';

export function stripeMode(): StripeMode {
  return process.env['E2E_STRIPE_MODE'] === 'ui' ? 'ui' : 'webhook';
}

/** Carte de test sans friction 3DS. Ne jamais utiliser une vraie carte ici. */
export const TEST_CARD = {
  number: '4242 4242 4242 4242',
  expiry: '12 / 34',
  cvc: '123',
  zip: '75001',
};

/** Garde-fou : refuse de tourner si la config pointe vers du LIVE. */
export function assertStripeTestMode(): void {
  const key = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY absente : le test de paiement ne peut pas tourner. ' +
        'Voir apps/app-mytradingcoach-e2e/README.md.',
    );
  }
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY n\'est pas une clé de TEST (sk_test_…). ' +
        'Refus de lancer un test de paiement sur des clés LIVE.',
    );
  }
}

/**
 * Remplit la page Stripe Checkout hébergée et valide le paiement.
 *
 * Les champs carte vivent dans des iframes Stripe. On les cible par leur `title`
 * (stable côté Stripe et localisé), avec un repli sur le premier iframe de la page.
 * Timeouts volontairement généreux : page tierce + réseau.
 */
export async function payOnHostedCheckout(page: Page): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });

  const frame = await resolveCardFrame(page);

  await frame.locator('[name="cardNumber"]').fill(TEST_CARD.number);
  await frame.locator('[name="cardExpiry"]').fill(TEST_CARD.expiry);
  await frame.locator('[name="cardCvc"]').fill(TEST_CARD.cvc);

  // Champs conditionnels selon le pays / la config du compte Stripe.
  const name = frame.locator('[name="billingName"]');
  if (await name.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await name.fill('Filleul E2E');
  }
  const zip = frame.locator('[name="billingPostalCode"]');
  if (await zip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await zip.fill(TEST_CARD.zip);
  }

  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
}

/** Iframe portant les champs carte, avec repli si Stripe change ses `title`. */
async function resolveCardFrame(page: Page): Promise<FrameLocator> {
  const byName = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  if (
    await byName
      .locator('[name="cardNumber"]')
      .isVisible({ timeout: 15_000 })
      .catch(() => false)
  ) {
    return byName;
  }
  // Repli : premier iframe contenant un champ carte.
  const anyFrame = page.frameLocator('iframe').first();
  await expect(
    anyFrame.locator('[name="cardNumber"]'),
    'Champ carte introuvable sur la page Stripe hébergée : les sélecteurs Stripe ' +
      'ont probablement changé. Basculer sur E2E_STRIPE_MODE=webhook et ouvrir un ticket.',
  ).toBeVisible({ timeout: 15_000 });
  return anyFrame;
}

/**
 * Forge et poste un `invoice.payment_succeeded` SIGNÉ sur le webhook de l'API.
 *
 * Reproduit exactement la forme que `processReferral` consomme :
 *   - `customer`                                  → retrouve le filleul
 *   - `parent.subscription_details.subscription`  → clé d'upsert de la commission
 *   - `amount_paid` (centimes)                    → base des 20 %
 *
 * @returns le statut HTTP renvoyé par le webhook (200 attendu).
 */
export async function sendSignedInvoicePaid(args: {
  apiUrl: string;
  webhookSecret: string;
  stripeCustomerId: string;
  subscriptionId: string;
  amountPaidCents: number;
}): Promise<{ status: number; body: string }> {
  const { apiUrl, webhookSecret, stripeCustomerId, subscriptionId, amountPaidCents } = args;

  const event = {
    id: `evt_e2e_${Date.now()}`,
    object: 'event',
    api_version: '2025-01-27',
    created: Math.floor(Date.now() / 1000),
    type: 'invoice.payment_succeeded',
    livemode: false,
    data: {
      object: {
        id: `in_e2e_${Date.now()}`,
        object: 'invoice',
        customer: stripeCustomerId,
        amount_paid: amountPaidCents,
        currency: 'eur',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: subscriptionId },
        },
      },
    },
  };

  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const res = await fetch(`${apiUrl}/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });

  return { status: res.status, body: await res.text() };
}
