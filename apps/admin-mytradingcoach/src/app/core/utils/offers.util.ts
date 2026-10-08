import { PRICING_EUR } from '../constants/pricing.const';
import type { AdminUser, FounderSeatStatus } from '../api/admin.api';

/**
 * Libellés de l'offre fondateur et des codes partenaires (#525) — fonctions PURES, testées.
 */

export const FOUNDER_STATUS_LABEL: Record<FounderSeatStatus, string> = {
  ACTIVE: 'actif',
  LOST: 'perdu',
  REFUNDED: 'remboursé',
  RELEASED: 'libéré',
};

/** Classe de badge par statut (badges existants de l'admin). */
export const FOUNDER_STATUS_BADGE: Record<FounderSeatStatus, string> = {
  ACTIVE: 'b-ok',
  LOST: 'b-free',
  REFUNDED: 'b-manual',
  RELEASED: 'b-manual',
};

/** « bandeau 12 · carte 30 · modale 5 · (sans clic) 2 », du plus fréquent au moins fréquent. */
export function ctaRecap(byCta: { cta: string | null; count: number }[]): string {
  if (!byCta.length) return 'aucune place prise';
  return [...byCta]
    .sort((a, b) => b.count - a.count)
    .map((r) => `${r.cta ?? '(sans clic)'} ${r.count}`)
    .join(' · ');
}

export interface PartnerFormValue {
  priceMonthlyEur: number | null;
  priceAnnualEur: number | null;
  /** null = à vie */
  durationMonths: number | null;
  /** null = illimité */
  maxRedemptions: number | null;
  /** AAAA-MM-JJ, '' = sans fin */
  expiresAt: string;
}

/**
 * Aperçu en une phrase avant validation :
 * « 29 €/mois ou 290 €/an, à vie, pour 10 personnes max, utilisable jusqu'au 31/12/2026 ».
 */
export function partnerPreview(v: PartnerFormValue): string {
  const m = v.priceMonthlyEur ?? '?';
  const y = v.priceAnnualEur ?? '?';
  const duration = v.durationMonths === null ? 'à vie' : `pendant ${v.durationMonths} mois puis prix normal`;
  const people = v.maxRedemptions === null ? 'sans limite de personnes' : `pour ${v.maxRedemptions} personne${v.maxRedemptions > 1 ? 's' : ''} max`;
  const until = v.expiresAt ? `, utilisable jusqu'au ${frDate(v.expiresAt)}` : ', sans date de fin';
  return `${m} €/mois ou ${y} €/an, ${duration}, ${people}${until}`;
}

/** Effet de la durée sur l'annuel (aide du formulaire). */
export function annualDurationHelp(durationMonths: number | null): string {
  if (durationMonths === null) return "À vie : chaque renouvellement, mensuel ou annuel, garde le prix remisé.";
  if (durationMonths <= 12) {
    return `Sur l'annuel, ${durationMonths} mois = seule la 1re facture annuelle est remisée, puis prix normal.`;
  }
  return `Sur l'annuel, ${durationMonths} mois = chaque facture annuelle émise pendant ${durationMonths} mois est remisée.`;
}

/** « 4 / 10 » ou « 4 / illimité ». */
export function usageLabel(used: number, max: number | null): string {
  return `${used} / ${max ?? 'illimité'}`;
}

/** Montant réellement payé d'un abonné Stripe : fondateur, code partenaire en cours, sinon prix normal. */
export function realAmountLabel(
  u: Pick<AdminUser, 'stripeInterval' | 'founderSeat' | 'partnerRedemption'>,
  now = new Date(),
): string {
  const yearly = u.stripeInterval === 'year';
  if (!u.stripeInterval) return '-';
  if (u.founderSeat?.status === 'ACTIVE') {
    return yearly ? `${PRICING_EUR.FOUNDER.annual} €/an` : `${PRICING_EUR.FOUNDER.monthly} €/mois`;
  }
  const r = u.partnerRedemption;
  if (r?.status === 'ACTIVE') {
    const end = r.durationMonths === null ? null : addMonths(new Date(r.createdAt), r.durationMonths);
    if (!end || end > now) return yearly ? `${r.priceAnnualEur} €/an` : `${r.priceMonthlyEur} €/mois`;
  }
  return yearly ? `${PRICING_EUR.PREMIUM.annual} €/an` : `${PRICING_EUR.PREMIUM.monthly} €/mois`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

function frDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** « 29 €/mois ou 290 €/an, à vie » · « …, pendant 3 mois puis prix normal » (conditions figées). */
export function partnerConditions(p: { priceMonthlyEur: number; priceAnnualEur: number; durationMonths: number | null }): string {
  const base = `${p.priceMonthlyEur} €/mois ou ${p.priceAnnualEur} €/an`;
  return p.durationMonths === null ? `${base}, à vie` : `${base}, pendant ${p.durationMonths} mois puis prix normal`;
}
