/**
 * Crée (idempotent) les DEUX coupons de parrainage dans Stripe :
 *   - REFERRAL_FILLEUL_10PCT          (annuel, -10% once)
 *   - REFERRAL_FILLEUL_MONTHLY_10PCT  (mensuel, -10% repeating 12 mois)
 * en REUTILISANT la logique existante (StripeService.ensureReferralCouponNow →
 * ensureReferralCoupon, paramètres inchangés).
 *
 * Ecrit VOLONTAIREMENT dans Stripe selon la clé de l'env courant (donc Live sur la prod).
 * Aucun garde-fou anti-prod : c'est le but. Affiche le mode de clé (LIVE/TEST) en sécurité.
 * Ne touche PAS la base de données.
 *
 * Usage : charger l'env (STRIPE_SECRET_KEY) puis (le --tsconfig est requis car
 * StripeService utilise des décorateurs de paramètre @InjectQueue) :
 *   node_modules/.bin/tsx --tsconfig apps/api-mytradingcoach/tsconfig.app.json \
 *     apps/api-mytradingcoach/src/scripts/ensure-referral-coupon.ts
 */
import { StripeService } from '../modules/stripe/stripe.service';

const KINDS = ['annual', 'monthly'] as const;

async function main(): Promise<void> {
  const key = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (!key) throw new Error('STRIPE_SECRET_KEY absent — refuse de tourner.');

  const mode = key.startsWith('sk_live_')
    ? 'LIVE'
    : key.startsWith('sk_test_')
      ? 'TEST'
      : 'INCONNU';
  if (mode === 'INCONNU') {
    console.warn('⚠️  Préfixe de clé inattendu (ni sk_live_ ni sk_test_) — vérifie STRIPE_SECRET_KEY.');
  }
  console.log(`Mode clé Stripe : ${mode}`);

  // Même mode de bootstrap que backfill-referral-codes : instanciation directe du
  // vrai StripeService. Seul STRIPE_SECRET_KEY (via config) est utilisé au constructeur ;
  // le reste (prisma/resend/discord/queue/redis) n'est pas sollicité par le coupon.
  const config = {
    getOrThrow: (k: string) => {
      const v = process.env[k];
      if (!v) throw new Error(`Config absente : ${k}`);
      return v;
    },
    get: (k: string) => process.env[k],
  };
  const stripeService = new StripeService(
    config as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );

  for (const kind of KINDS) {
    // Détecte créé vs déjà présent : on tente un retrieve AVANT l'ensure.
    const before = await stripeService.findReferralCoupon(kind);
    const coupon = await stripeService.ensureReferralCouponNow(kind);
    const state = before ? 'déjà présent' : 'créé';

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
