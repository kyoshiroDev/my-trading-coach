import {
  ACCOUNT_LIMITS,
  FOUNDER_OFFER,
  FOUNDER_REFUND_DAYS,
  PREMIUM_ANNUAL_SAVINGS_EUR,
  PREMIUM_PRICE_EUR,
  PREMIUM_SIGNUP_TRIAL_DAYS,
  REFERRAL_DISCOUNT,
  TRIAL_PERIOD_DAYS,
} from '@mtc/shared';
import { TRADOVATE_BACKGROUND_SYNC_MINUTES } from '../integrations/tradovate/tradovate-background-refresh.const';

/**
 * Variables de la base de connaissances (#493) : prix et durées viennent des constantes de `@mtc/shared`,
 * jamais écrits dans `kb/`. Les variables dynamiques (places fondateur, liste des firms) sont fournies par
 * le service à l'exécution. Fonctions PURES.
 */
export const HELP_KB_STATIC_VARIABLES: Readonly<Record<string, string>> = {
  PREMIUM_MONTHLY: String(PREMIUM_PRICE_EUR.monthly),
  PREMIUM_YEARLY: String(PREMIUM_PRICE_EUR.annual),
  PREMIUM_ANNUAL_SAVINGS: String(PREMIUM_ANNUAL_SAVINGS_EUR),
  TRIAL_DAYS: String(PREMIUM_SIGNUP_TRIAL_DAYS),
  STRIPE_TRIAL_DAYS: String(TRIAL_PERIOD_DAYS),
  FOUNDER_MONTHLY: String(FOUNDER_OFFER.priceMonthlyEur),
  FOUNDER_YEARLY: String(FOUNDER_OFFER.priceAnnualEur),
  FOUNDER_SEATS: String(FOUNDER_OFFER.seats),
  FOUNDER_REFUND_DAYS: String(FOUNDER_REFUND_DAYS),
  REFERRAL_DISCOUNT_PCT: String(Math.round(REFERRAL_DISCOUNT.rate * 100)),
  REFERRAL_DISCOUNT_MONTHS: String(REFERRAL_DISCOUNT.months),
  FREE_ACCOUNT_LIMIT: String(ACCOUNT_LIMITS.free),
  BACKGROUND_SYNC_MINUTES: String(TRADOVATE_BACKGROUND_SYNC_MINUTES),
};

/** Variables calculées à l'exécution (places restantes, catalogue). */
export const HELP_KB_DYNAMIC_VARIABLES = ['FOUNDER_SEATS_LABEL', 'PROP_FIRM_LIST'] as const;

export const kbVariables = (body: string): string[] => [...new Set([...body.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]))];

/** Remplace les variables ; lève si l'une manque (jamais une réponse avec « {{…}} » à l'écran). */
export function renderKbBody(body: string, vars: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v == null) throw new Error(`variable de la base sans valeur : ${name}`);
    return v;
  });
}
