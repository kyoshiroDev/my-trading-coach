/**
 * Crée (idempotent) les DEUX coupons de parrainage dans Stripe :
 *   - REFERRAL_FILLEUL_10PCT          (annuel, -10% once)
 *   - REFERRAL_FILLEUL_MONTHLY_10PCT  (mensuel, -10% repeating 12 mois)
 * en REUTILISANT la logique existante (StripeCouponService.ensureReferralCouponNow →
 * ensureReferralCoupon, paramètres inchangés).
 *
 * Ecrit VOLONTAIREMENT dans Stripe selon la clé de l'env courant (donc Live sur la prod).
 * Aucun garde-fou anti-prod : c'est le but. Affiche le mode de clé (LIVE/TEST) en sécurité.
 * Ne touche PAS la base de données.
 *
 * Usage : charger l'env (STRIPE_SECRET_KEY) puis (le --tsconfig est requis car
 * StripeCouponService utilise un décorateur de paramètre @Inject) :
 *   node_modules/.bin/tsx --tsconfig apps/api-mytradingcoach/tsconfig.app.json \
 *     apps/api-mytradingcoach/src/scripts/ensure-referral-coupon.ts
 */
import { createStripeClient } from '../modules/stripe/stripe.client';
import { StripeCouponService } from '../modules/stripe/stripe-coupon.service';

const KINDS = ['annual', 'monthly'] as const;

async function main(): Promise<void> {
  const key = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (!key) throw new Error('STRIPE_SECRET_KEY absent, refuse de tourner.');

  const mode = key.startsWith('sk_live_')
    ? 'LIVE'
    : key.startsWith('sk_test_')
      ? 'TEST'
      : 'INCONNU';
  if (mode === 'INCONNU') {
    console.warn('⚠️  Préfixe de clé inattendu (ni sk_live_ ni sk_test_) : vérifie STRIPE_SECRET_KEY.');
  }
  console.log(`Mode clé Stripe : ${mode}`);

  // Instanciation directe, hors Nest : le service de coupons ne dépend que du
  // client Stripe, construit avec la clé de l'env courant.
  const couponService = new StripeCouponService(createStripeClient(key));

  // Détecte créé vs déjà présent : on tente un retrieve AVANT l'ensure, par kind.
  const before = {
    annual: await couponService.findReferralCoupon('annual'),
    monthly: await couponService.findReferralCoupon('monthly'),
  };

  const coupons = await couponService.ensureReferralCouponNow();

  for (const kind of KINDS) {
    const coupon = coupons[kind];
    const state = before[kind] ? 'déjà présent' : 'créé';

    console.log(
      JSON.stringify(
        {
          kind,
          state,
          id: coupon.id,
          percent_off: coupon.percent_off,
          duration: coupon.duration,
          duration_in_months: coupon.duration_in_months,
          name: coupon.name,
          valid: coupon.valid,
          mode,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Ensure coupon échoué :', err);
    process.exit(1);
  });
