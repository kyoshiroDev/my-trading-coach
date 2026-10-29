import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { SILENT_ERRORS } from '@mtc/front-ui';
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
  /** Réservation fondateur pendant le Premium offert (#769) : premier prélèvement (ISO), sinon null. */
  firstChargeAt?: string | null;
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
    /** Fin du satisfait ou remboursé (null = plus remboursable, ou place réservée pas encore payée). */
    refundUntil: string | null;
    /** Réservation possible pendant le Premium offert : premier prélèvement à cette date (#769). */
    firstChargeAt?: string | null;
    /** Place réservée, premier prélèvement à venir (#769). */
    reservedUntilCharge?: boolean;
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

  /** `silent` : l'écran affiche lui-même l'échec (modale de plans, #578), pas de toast en plus. */
  offers(opts: { silent?: boolean } = {}) {
    return this.http.get<{ data: BillingOffers }>(`${this.base}/offers`, {
      context: new HttpContext().set(SILENT_ERRORS, !!opts.silent),
    });
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
