import { roundCents } from '@mtc/shared';
import { realMonthlyEur, type PartnerConditions } from '../partner-codes/partner-code.util';

/** Commission ambassadeur : 20 % du montant payé (plans.md). */
export const AMBASSADOR_COMMISSION_RATE = 0.2;

export interface ReferralBilling {
  plan: string;
  stripeInterval: string | null;
  stripeSubscriptionStatus: string | null;
  founderSeat: { status: string } | null;
  partnerRedemption: (PartnerConditions & { status: string; createdAt: Date }) | null;
}

/**
 * Commission mensuelle estimée d'un filleul : 20 % du montant MENSUEL réellement payé (fondateur,
 * annuel ÷ 12, code partenaire), même calcul que le MRR admin (`realMonthlyEur`, abonnements
 * `active` seulement). Avant (#947), 9,80 € fixes pour tout filleul Premium, essai compris.
 */
export function referralMonthlyCommission(u: ReferralBilling, now: Date): number {
  if (u.plan !== 'PREMIUM' || u.stripeSubscriptionStatus !== 'active') return 0;
  const r = u.partnerRedemption?.status === 'ACTIVE' ? u.partnerRedemption : null;
  const monthly = realMonthlyEur({
    interval: u.stripeInterval === 'year' ? 'year' : 'month',
    founder: u.founderSeat?.status === 'ACTIVE',
    partner: r ? { ...r, since: r.createdAt } : null,
    now,
  });
  return roundCents(monthly * AMBASSADOR_COMMISSION_RATE);
}
