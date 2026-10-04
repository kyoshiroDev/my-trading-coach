import { Prisma } from '@prisma/client';
import Stripe from 'stripe';

// ── Constantes ────────────────────────────────────────────────────────────────

export const STRIPE_QUEUE = 'stripe';

export const BILLING_CACHE_TTL_SECONDS = 300; // 5 min
export const billingCacheKey = (userId: string) => `billing:status:${userId}`;

/** Statuts Stripe qui confèrent l'accès PREMIUM */
export const ACTIVE_STATUSES = new Set<Stripe.Subscription['status']>([
  'active',
  'trialing',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

export function extractId(
  resource: string | { id: string } | null | undefined,
): string | null {
  if (!resource) return null;
  return typeof resource === 'string' ? resource : resource.id;
}

/** Montant Stripe (centimes) → `49,00 €` ; devise invalide → montant + code brut. */
export function formatInvoiceAmount(amountCents: number, currency: string | null | undefined): string {
  const value = amountCents / 100;
  const code = (currency ?? 'eur').toUpperCase();
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Mois de rattachement d'une commission (`YYYY-MM`), dérivé de la FACTURE.
 *
 * Jamais `Date.now()` : la clé d'unicité est `(subscriptionId, period)`, et un
 * traitement décalé (retry BullMQ, redélivrance Stripe après une indisponibilité)
 * rangeait la commission dans le mois du traitement. Une facture de janvier
 * traitée le 1ᵉʳ février prenait la clé de février, puis l'`upsert` de la vraie
 * facture de février ÉCRASAIT cette ligne : l'ambassadeur perdait un mois.
 *
 * `period_start` fait foi (début de la période facturée) ; `created` sert de
 * repli, et l'heure de traitement n'intervient qu'en dernier recours théorique.
 */
export function invoicePeriod(invoice: Stripe.Invoice): string {
  const epoch = invoice.period_start ?? invoice.created ?? null;
  const date = epoch != null ? new Date(epoch * 1000) : new Date();
  return date.toISOString().slice(0, 7);
}
