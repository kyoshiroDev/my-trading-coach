import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan, Role } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.client';
import { extractId, invoicePeriod, isUniqueConstraintError } from './stripe.helpers';
import { StripeCustomerService } from './stripe-customer.service';

/** Récompense du parrain au paiement d'un filleul (commission ou mois offert). */
@Injectable()
export class StripeReferralService {
  private readonly logger = new Logger(StripeReferralService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly customers: StripeCustomerService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /**
   * Récompense de parrainage au paiement d'un filleul. Règle de coexistence,
   * décidée par le RÔLE du parrain (user dont referralCode == filleul.referredBy) :
   *  - parrain AMBASSADOR → commission cash (existant), JAMAIS de mois offert.
   *  - parrain user normal → mois offert (1 par filleul payant).
   * Anti-abus : paiement réel uniquement, jamais l'auto-parrainage (single-level),
   * une seule récompense par filleul.
   */
  async processReferral(invoice: Stripe.Invoice): Promise<void> {
    try {
      const stripeCustomerId = invoice.customer as string;
      const subscriptionId = extractId(
        invoice.parent?.subscription_details?.subscription,
      );
      const amountPaid = (invoice.amount_paid ?? 0) / 100;

      if (!stripeCustomerId || !subscriptionId || amountPaid <= 0) return;

      const filleul = await this.prisma.user.findFirst({
        where: { stripeCustomerId },
        select: { id: true, referredBy: true, plan: true },
      });
      if (!filleul?.referredBy) return;

      const parrain = await this.prisma.user.findFirst({
        where: { referralCode: filleul.referredBy },
        select: { id: true, role: true },
      });
      if (!parrain) return;
      if (parrain.id === filleul.id) return; // anti auto-parrainage (single-level)

      if (parrain.role === Role.AMBASSADOR) {
        await this.creditAmbassadorCommission({
          ambassadorId: parrain.id,
          filleul,
          subscriptionId,
          amountPaid,
          period: invoicePeriod(invoice),
        });
      } else {
        await this.grantReferralFreeMonth({
          parrainId: parrain.id,
          filleulId: filleul.id,
          subscriptionId,
        });
      }
    } catch (err) {
      // On loggue PUIS on relance : avaler l'erreur faisait finir le job BullMQ en
      // succès, donc aucune des 5 tentatives n'était utilisée et l'event était déjà
      // marqué traité → commission ou mois offert définitivement perdu sur une
      // simple panne transitoire. Même comportement que `syncSubscription`, qui
      // laisse déjà remonter.
      //
      // Rejouable sans double crédit : la commission passe par un `upsert` sur
      // (subscriptionId, period), le mois offert par `@unique(filleulId)`, et le
      // crédit Stripe par une `idempotencyKey` dérivée du filleul.
      this.logger.error('Erreur traitement parrainage (retry BullMQ déclenché)', err);
      throw err;
    }
  }

  /** Commission cash 20% pour un parrain AMBASSADEUR (comportement existant). */
  private async creditAmbassadorCommission(args: {
    ambassadorId: string;
    filleul: { id: string; referredBy: string | null; plan: Plan };
    subscriptionId: string;
    amountPaid: number;
    /** Mois de RATTACHEMENT, dérivé de la facture (jamais de l'heure de traitement). */
    period: string;
  }): Promise<void> {
    const { ambassadorId, filleul, subscriptionId, amountPaid, period } = args;
    const commission = +(amountPaid * 0.2).toFixed(2);

    await this.prisma.referralCommission.upsert({
      where: { subscriptionId_period: { subscriptionId, period } },
      create: {
        ambassadorId,
        referredUserId: filleul.id,
        amount: commission,
        subscriptionId,
        period,
        status: 'pending',
      },
      update: { amount: commission },
    });

    this.logger.log(
      `Commission referral : ${commission}€ pour ambassadeur ${filleul.referredBy}` +
      ` (plan: ${filleul.plan}, sub: ${subscriptionId})`,
    );
  }

  /** Mois offert à un parrain NORMAL : 1 par filleul payant, crédité chez Stripe. */
  private async grantReferralFreeMonth(args: {
    parrainId: string;
    filleulId: string;
    subscriptionId: string;
  }): Promise<void> {
    const { parrainId, filleulId, subscriptionId } = args;

    // 1 récompense par filleul : la contrainte @unique(filleulId) tranche. La ligne
    // est créée AVANT le chiffrage et sert d'ancre d'idempotence durable (la clé
    // d'idempotence Stripe, elle, expire au bout de ~24 h).
    let reward;
    try {
      reward = await this.prisma.referralReward.create({
        data: { parrainId, filleulId, subscriptionId, status: 'PENDING', amountEur: 0 },
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      // Récompense déjà enregistrée. Si elle a été APPLIQUÉE, il n'y a rien à faire.
      // Si elle est restée PENDING (chiffrage impossible au passage précédent :
      // parrain non abonné, prix Stripe injoignable), on REJOUE ici. Sans ça, la
      // contrainte d'unicité gelait définitivement le mois offert : plus aucune
      // facture ultérieure ne pouvait le débloquer, seul un rattrapage admin
      // manuel restait possible.
      const existing = await this.prisma.referralReward.findUnique({ where: { filleulId } });
      if (!existing || existing.status === 'APPLIED') {
        this.logger.debug(`Mois offert déjà accordé pour le filleul ${filleulId}`);
        return;
      }
      this.logger.log(`Mois offert encore PENDING pour le filleul ${filleulId} : nouvelle tentative.`);
      reward = existing;
    }

    const parrain = await this.prisma.user.findUnique({
      where: { id: parrainId },
      select: { email: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });
    if (!parrain) return;

    const monthCents = await this.resolveFreeMonthCents(parrain.stripeSubscriptionId);
    if (monthCents <= 0) {
      this.logger.warn(
        `Mois offert non chiffrable (parrain ${parrainId}) : reward laissé PENDING, ` +
        'il sera rejoué à la prochaine facture du filleul.',
      );
      return; // reste PENDING : visible dans « mois à appliquer » côté admin
    }

    const customerId =
      parrain.stripeCustomerId ??
      (await this.customers.ensureStripeCustomer(parrainId, parrain.email));

    // Garde-fou durable contre le double crédit : la clé d'idempotence Stripe ne
    // protège que ~24 h, or un rejeu peut intervenir un mois plus tard (crash entre
    // le crédit et le passage en APPLIED). On vérifie donc côté Stripe qu'aucun
    // avoir ne porte déjà ce filleul avant d'en créer un.
    if (await this.hasReferralCredit(customerId, filleulId)) {
      this.logger.warn(
        `Avoir de parrainage déjà présent chez Stripe pour le filleul ${filleulId} : ` +
        'pas de second crédit, la ligne est juste réconciliée.',
      );
    } else {
      // Avoir sur le solde client (négatif = crédit) → appliqué à sa prochaine facture.
      await this.stripe.customers.createBalanceTransaction(
        customerId,
        {
          amount: -monthCents,
          currency: 'eur',
          description: `Mois offert · parrainage (filleul ${filleulId})`,
          metadata: { referralFilleulId: filleulId },
        },
        { idempotencyKey: `referral-reward-${filleulId}` },
      );
    }

    await this.prisma.referralReward.update({
      where: { id: reward.id },
      data: { status: 'APPLIED', amountEur: +(monthCents / 100).toFixed(2) },
    });

    this.logger.log(
      `Mois offert (${(monthCents / 100).toFixed(2)}€) crédité au parrain ${parrainId} (filleul ${filleulId})`,
    );
  }

  /**
   * Un avoir de parrainage pour ce filleul existe-t-il déjà chez Stripe ?
   *
   * Dédoublonnage durable, là où `idempotencyKey` expire (~24 h) alors qu'un rejeu
   * peut survenir à la facture suivante, un mois plus tard. En cas d'erreur réseau
   * on répond `false` : la clé d'idempotence reste le filet de court terme, et un
   * mois offert manquant se rattrape — mieux que de bloquer sur une lecture ratée.
   */
  private async hasReferralCredit(customerId: string, filleulId: string): Promise<boolean> {
    const list = await this.stripe.customers
      .listBalanceTransactions(customerId, { limit: 100 })
      .catch(() => null);
    return (
      list?.data.some((t) => t.metadata?.['referralFilleulId'] === filleulId) ?? false
    );
  }

  /** Montant d'un mois en cents : mensualité du parrain s'il est abonné, sinon Premium mensuel. */
  private async resolveFreeMonthCents(parrainSubId: string | null): Promise<number> {
    if (parrainSubId) {
      const sub = await this.stripe.subscriptions.retrieve(parrainSubId).catch(() => null);
      const price = sub?.items.data[0]?.price;
      if (price?.unit_amount != null) {
        return price.recurring?.interval === 'year'
          ? Math.round(price.unit_amount / 12)
          : price.unit_amount;
      }
    }
    // Défaut prudent (protège la marge) : mensualité Premium (49€).
    const premiumMonthly = this.config.get<string>('STRIPE_PREMIUM_PRICE_MONTHLY_V2');
    if (premiumMonthly) {
      const price = await this.stripe.prices.retrieve(premiumMonthly).catch(() => null);
      if (price?.unit_amount != null) return price.unit_amount;
    }
    return 0;
  }
}
