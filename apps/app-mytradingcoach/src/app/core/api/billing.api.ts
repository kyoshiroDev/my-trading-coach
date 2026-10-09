import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@app/environments/environment';

export type CheckoutPlan = 'premium_monthly' | 'premium_yearly' | 'founder_monthly' | 'founder_yearly';
export type BillingInterval = 'month' | 'year';

/** Conditions d'un code partenaire (figées pour l'abonné une fois obtenues). */
export interface PartnerConditions {
  code: string;
  priceMonthlyEur: number;
  priceAnnualEur: number;
  /** null = à vie (tant que l'abonnement reste actif). */
  durationMonths: number | null;
  label: string;
}

/** Validation d'un code saisi : conditions, ou raison précise du refus. */
export type PartnerValidation =
  | ({ valid: true } & PartnerConditions)
  | { valid: false; code: string; reason: string; message: string };

/** Récapitulatif renvoyé avec la session de la page de paiement de l'app. */
export interface CheckoutSummary {
  offer: 'premium' | 'founder' | 'partner';
  interval: BillingInterval;
  /** Montant récurrent après remise fondateur ou partenaire (€). */
  recurringEur: number;
  /** Prix normal de l'intervalle (€), pour le prix barré. */
  normalEur: number;
  /** Jours d'essai (0 = prélèvement immédiat). */
  trialDays: number;
  partnerCode: string | null;
  /** null = remise à vie. */
  partnerDurationMonths: number | null;
  /** −10 % filleul sur la première année. */
  referralDiscount: boolean;
  seatsLeft: number | null;
}

/** `POST /billing/checkout` : clé de session (page de l'app) ou URL (page Stripe, repli). */
export type CheckoutStart =
  | { url: string }
  | { clientSecret: string; publishableKey: string; summary: CheckoutSummary };

/** `GET /billing/offers` : offre fondateur, code partenaire actif, intervalle (#525). */
export interface BillingOffers {
  founderOffer: { open: boolean; seatsLeft: number; seatsTotal: number };
  founder: {
    isFounder: boolean;
    number: number | null;
    interval: BillingInterval | null;
    since: string | null;
    eligible: boolean;
    ineligibleReason: string | null;
    /** Fin du satisfait ou remboursé (null = plus remboursable). */
    refundUntil: string | null;
  };
  partner: (PartnerConditions & { since: string; endsAt: string | null }) | null;
  subscription: { interval: BillingInterval | null; status: string | null };
}

@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/billing`;

  checkout(plan: CheckoutPlan, opts: { cta?: string | null; promo?: string | null; ui?: 'hosted' | 'elements' } = {}) {
    return this.http.post<{ data: CheckoutStart }>(`${this.base}/checkout`, {
      plan,
      ...(opts.cta ? { cta: opts.cta } : {}),
      ...(opts.promo ? { promo: opts.promo } : {}),
      ...(opts.ui ? { ui: opts.ui } : {}),
    });
  }

  offers() {
    return this.http.get<{ data: BillingOffers }>(`${this.base}/offers`);
  }

  validatePartnerCode(code: string) {
    return this.http.get<{ data: PartnerValidation }>(`${this.base}/partner/${encodeURIComponent(code)}`);
  }

  changeInterval(interval: BillingInterval) {
    return this.http.post<{ data: { changed: boolean } }>(`${this.base}/interval`, { interval });
  }

  portal() {
    return this.http.get<{ data: { url: string } }>(`${this.base}/portal`);
  }
}
