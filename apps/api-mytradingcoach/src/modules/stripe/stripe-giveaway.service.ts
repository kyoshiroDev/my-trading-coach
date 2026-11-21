import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { STRIPE_CLIENT } from './stripe.client';

/** Ce que le tirage Premium lit chez Stripe pour un client (PROMPT-tirage-mensuel). */
export interface GiveawayBillingFacts {
  /** Factures payées avec un vrai paiement (`amount_paid` > 0). Les factures à 0 € ne comptent pas. */
  paidInvoices: number;
  /** Premier paiement réel, null s'il n'y en a aucun. */
  firstPaidAt: Date | null;
  /**
   * Montant d'une échéance réellement facturée (centimes, après remise, avant avoir) : `total` de la
   * dernière facture d'échéance payée. Couvre le prix fondateur et la remise filleul sans relire les
   * coupons. Null si aucune facture d'échéance > 0.
   */
  chargeCents: number | null;
  /** Intervalle de cette échéance. */
  interval: 'month' | 'year' | null;
}

/** Métadonnée de l'avoir du tirage : dédoublonnage durable (la clé d'idempotence expire en ~24 h). */
export const GIVEAWAY_CREDIT_METADATA = 'giveawayWinId';

/** Factures d'échéance (pas les factures de prorata d'un changement d'intervalle). */
const CYCLE_REASONS = new Set(['subscription_cycle', 'subscription_create']);

/**
 * Lot du tirage Premium chez Stripe : lecture des factures (ancienneté) et avoir sur le solde client.
 * Avoir et non `trial_end` : l'abonnement n'est jamais modifié (pas de statut d'essai, MRR intact,
 * circuit fondateur non relancé), même mécanisme que le mois offert du parrainage.
 */
@Injectable()
export class StripeGiveawayService {
  private readonly logger = new Logger(StripeGiveawayService.name);

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  /** Factures payées du client (par client, pas par abonnement : un changement d'intervalle en crée un nouveau). */
  async billingFacts(customerId: string): Promise<GiveawayBillingFacts> {
    const invoices: Stripe.Invoice[] = [];
    for await (const invoice of this.stripe.invoices.list({ customer: customerId, status: 'paid', limit: 100 })) {
      invoices.push(invoice);
      if (invoices.length >= 500) break; // plafond de lecture, très au-delà d'un historique réel
    }
    const paid = invoices.filter((i) => (i.amount_paid ?? 0) > 0);
    const paidAt = (i: Stripe.Invoice) => (i.status_transitions?.paid_at ?? i.created) * 1000;
    const firstPaidAt = paid.length ? new Date(Math.min(...paid.map(paidAt))) : null;
    // La liste Stripe est triée de la plus récente à la plus ancienne.
    const lastCycle = invoices.find((i) => CYCLE_REASONS.has(i.billing_reason ?? '') && (i.total ?? 0) > 0);
    const line = lastCycle?.lines?.data?.find((l) => (l as { price?: Stripe.Price | null }).price?.recurring);
    const recurring = (line as { price?: Stripe.Price | null } | undefined)?.price?.recurring;
    const interval = recurring?.interval === 'year' ? 'year' : recurring?.interval === 'month' ? 'month' : null;
    return {
      paidInvoices: paid.length,
      firstPaidAt,
      chargeCents: lastCycle ? lastCycle.total : null,
      interval,
    };
  }

  /**
   * Avoir du lot (montant négatif = crédit), consommé par les prochaines factures. Idempotent : un avoir
   * qui porte déjà ce lot n'est jamais recréé (rejeu d'un job), la clé Stripe couvre les ~24 h.
   * Renvoie l'id de la transaction de solde.
   */
  async creditGiveaway(args: { customerId: string; winId: string; cents: number; months: number }): Promise<string> {
    const existing = await this.findCredit(args.customerId, args.winId);
    if (existing) {
      this.logger.warn(`Avoir du tirage déjà présent chez Stripe (lot ${args.winId}) : pas de second crédit.`);
      return existing;
    }
    const tx = await this.stripe.customers.createBalanceTransaction(
      args.customerId,
      {
        amount: -args.cents,
        currency: 'eur',
        description: `${args.months} mois offerts · tirage mensuel (lot ${args.winId})`,
        metadata: { [GIVEAWAY_CREDIT_METADATA]: args.winId },
      },
      { idempotencyKey: `giveaway-${args.winId}` },
    );
    return tx.id;
  }

  private async findCredit(customerId: string, winId: string): Promise<string | null> {
    // Une erreur de lecture ne bloque pas : la clé d'idempotence reste le filet de court terme.
    const list = await this.stripe.customers.listBalanceTransactions(customerId, { limit: 100 }).catch(() => null);
    return list?.data.find((t) => t.metadata?.[GIVEAWAY_CREDIT_METADATA] === winId)?.id ?? null;
  }
}
