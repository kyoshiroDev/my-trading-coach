import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe.client';

// Coupons réduc filleul : -10% sur la première année, selon l'intervalle choisi.
// - Annuel : duration once (l'annuel = 1 paiement = 1 an).
// - Mensuel : duration repeating 12 mois (les 12 premiers paiements).
const REFERRAL_COUPON_ID = 'REFERRAL_FILLEUL_10PCT';
const REFERRAL_COUPON_MONTHLY_ID = 'REFERRAL_FILLEUL_MONTHLY_10PCT';

export type ReferralCouponKind = 'annual' | 'monthly';

/** Coupons -10% du filleul (parrainage classique), créés à la demande chez Stripe. */
@Injectable()
export class StripeCouponService {
  private readonly referralCouponEnsured: Record<ReferralCouponKind, boolean> = {
    annual: false,
    monthly: false,
  };

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  /**
   * Crée (idempotent) le coupon -10% « première année » du parrainage filleul.
   * - annual : duration once (l'annuel = 1 paiement).
   * - monthly : duration repeating 12 mois (les 12 premiers paiements).
   * Retrieve d'abord, create sinon ; course condition (resource_already_exists)
   * ignorée. Flag d'« ensured » par kind.
   */
  async ensureReferralCoupon(kind: ReferralCouponKind): Promise<string> {
    const id = this.referralCouponId(kind);
    if (this.referralCouponEnsured[kind]) return id;
    try {
      await this.stripe.coupons.retrieve(id);
    } catch {
      const params: Stripe.CouponCreateParams =
        kind === 'annual'
          ? { id, percent_off: 10, duration: 'once', name: 'Parrainage -10% (1ère année)' }
          : { id, percent_off: 10, duration: 'repeating', duration_in_months: 12, name: 'Parrainage -10% (12 mois)' };
      try {
        await this.stripe.coupons.create(params);
      } catch (err) {
        // Course condition : créé entre-temps → ignorer le conflit, sinon relancer.
        const code = (err as Stripe.errors.StripeError)?.code;
        if (code !== 'resource_already_exists') throw err;
      }
    }
    this.referralCouponEnsured[kind] = true;
    return id;
  }

  /**
   * Pour l'outillage (script d'ensure) : `ensureReferralCoupon` sur les DEUX kinds,
   * puis retourne les deux coupons Stripe pour pouvoir les afficher.
   */
  async ensureReferralCouponNow(): Promise<{ annual: Stripe.Coupon; monthly: Stripe.Coupon }> {
    const annualId = await this.ensureReferralCoupon('annual');
    const monthlyId = await this.ensureReferralCoupon('monthly');
    const [annual, monthly] = await Promise.all([
      this.stripe.coupons.retrieve(annualId),
      this.stripe.coupons.retrieve(monthlyId),
    ]);
    return { annual, monthly };
  }

  /** Lecture seule : retourne le coupon de parrainage (selon kind) s'il existe déjà, sinon null. */
  async findReferralCoupon(kind: ReferralCouponKind): Promise<Stripe.Coupon | null> {
    return this.stripe.coupons.retrieve(this.referralCouponId(kind)).catch(() => null);
  }

  private referralCouponId(kind: ReferralCouponKind): string {
    return kind === 'annual' ? REFERRAL_COUPON_ID : REFERRAL_COUPON_MONTHLY_ID;
  }
}
