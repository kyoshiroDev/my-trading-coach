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
import { expect, Page } from '@playwright/test';
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
 * Remplit la page Stripe Checkout hébergée et valide.
 *
 * Ciblage par RÔLE + libellé accessible, pas par `name=` dans un iframe : sur la
 * page hébergée actuelle, les champs carte sont dans le document principal et
 * portent des labels accessibles (`Numéro de carte`, `Date d'expiration`,
 * `Code de sécurité`). L'ancien ciblage `iframe[name^="__privateStripeFrame"]`
 * ne matchait rien — cet iframe n'héberge que les boutons Apple Pay / Link.
 *
 * Les libellés sont en français : la session est créée avec `locale: 'fr'`
 * (cf. `createCheckoutSession`). Si Stripe change ses libellés, l'échec est
 * explicite et confiné à ce helper.
 *
 * Timeouts généreux : page tierce + réseau.
 */
export async function payOnHostedCheckout(page: Page): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });

  const cardNumber = page.getByRole('textbox', { name: 'Numéro de carte' });
  await expect(
    cardNumber,
    'Champ « Numéro de carte » introuvable sur la page Stripe hébergée : les libellés ' +
      'ou la structure ont changé. Repli : E2E_STRIPE_MODE=webhook, et corriger ce helper.',
  ).toBeVisible({ timeout: 30_000 });

  await cardNumber.fill(TEST_CARD.number);
  await page.getByRole('textbox', { name: "Date d'expiration" }).fill(TEST_CARD.expiry);
  await page.getByRole('textbox', { name: 'Code de sécurité' }).fill(TEST_CARD.cvc);

  // Champs conditionnels selon le pays et la config du compte Stripe.
  const holder = page.getByRole('textbox', { name: 'Nom du titulaire de la carte' });
  if (await holder.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await holder.fill('Filleul E2E');
  }

  // Le libellé du bouton dépend de l'offre : « Démarrer la période d'essai » quand
  // un essai est accordé, « S'abonner » / « Payer » sinon. On prend le bouton de
  // soumission du formulaire plutôt que de deviner le texte.
  const submit = page
    .locator('form button[type="submit"]')
    .filter({ hasNotText: 'Appliquer' })
    .last();
  await expect(submit, 'Bouton de validation du paiement introuvable').toBeVisible({
    timeout: 15_000,
  });
  await submit.click();
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
