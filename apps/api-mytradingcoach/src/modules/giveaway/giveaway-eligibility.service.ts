import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  GIVEAWAY_MIN_ACCOUNT_AGE_DAYS,
  GIVEAWAY_MIN_TRADES,
  GIVEAWAY_PREMIUM_MIN_PAID_INVOICES,
  GIVEAWAY_PREMIUM_MIN_PAID_MONTHS,
  GIVEAWAY_WIN_COOLDOWN_MONTHS,
  GiveawayPool,
  fullMonthsBetween,
  giveawayPeriod,
  previousParisMonthRange,
  shiftGiveawayPeriod,
} from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { REAL_USERS_WHERE } from '../../common/stats/real-users';
import { PREMIUM_OFFERABLE_WHERE } from '../users/premium-offer.util';
import { StripeGiveawayService, type GiveawayBillingFacts } from '../stripe/stripe-giveaway.service';

const DAY_MS = 24 * 3600_000;

/**
 * Règle d'ancienneté Premium (décision du 2026-11-21) : mensuel = au moins 2 factures payées (montant
 * > 0) ; annuel = premier paiement réel il y a au moins 2 mois civils. Pure, testée seule.
 */
export function premiumSeniorityOk(facts: GiveawayBillingFacts, interval: string | null, now: Date): boolean {
  const effective = facts.interval ?? (interval === 'year' ? 'year' : interval === 'month' ? 'month' : null);
  if (effective === 'year') {
    return !!facts.firstPaidAt && fullMonthsBetween(facts.firstPaidAt, now) >= GIVEAWAY_PREMIUM_MIN_PAID_MONTHS;
  }
  return facts.paidInvoices >= GIVEAWAY_PREMIUM_MIN_PAID_INVOICES;
}

/**
 * Éligibilité aux deux tirages (PROMPT-tirage-mensuel). Démo, internes, admins et comptes supprimés
 * exclus partout (`REAL_USERS_WHERE`, un compte supprimé n'a plus de ligne).
 */
@Injectable()
export class GiveawayEligibilityService {
  private readonly logger = new Logger(GiveawayEligibilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeGiveawayService,
  ) {}

  /**
   * Filtre commun aux deux tirages, sans l'activité ni Stripe : comptes réels, pas gagnants pendant
   * la carence (gagnant de la période P éligible de nouveau à P + 6).
   */
  private cooldownWhere(now: Date): Prisma.UserWhereInput {
    const since = shiftGiveawayPeriod(giveawayPeriod(now), -GIVEAWAY_WIN_COOLDOWN_MONTHS);
    return { giveawayWins: { none: { draw: { is: { period: { gt: since } } } } } };
  }

  /** Filtre Prisma du tirage des gratuits (hors activité). */
  freeWhere(now: Date): Prisma.UserWhereInput {
    return {
      AND: [
        REAL_USERS_WHERE,
        // Aucun abonnement Stripe actif, pas de paiement en attente, ni Premium ni BETA_TESTER : même
        // règle que « Offrir Premium » (le lot est un Premium offert).
        PREMIUM_OFFERABLE_WHERE,
        { createdAt: { lte: new Date(now.getTime() - GIVEAWAY_MIN_ACCOUNT_AGE_DAYS * DAY_MS) } },
        { emailVerifiedAt: { not: null } },
        this.cooldownWhere(now),
      ],
    };
  }

  /** Filtre Prisma du tirage Premium (hors activité et factures). */
  premiumWhere(now: Date): Prisma.UserWhereInput {
    return {
      AND: [
        REAL_USERS_WHERE,
        { stripeSubscriptionStatus: 'active' },
        { stripeSubscriptionId: { not: null } },
        { stripeCustomerId: { not: null } },
        { stripeCancelAt: null },
        this.cooldownWhere(now),
      ],
    };
  }

  /** Comptes avec au moins `GIVEAWAY_MIN_TRADES` trades dans `[start, end)`. */
  async activeUserIds(range: { start: Date; end: Date }, among?: string[]): Promise<Set<string>> {
    const rows = await this.prisma.trade.groupBy({
      by: ['userId'],
      where: { tradedAt: { gte: range.start, lt: range.end }, ...(among ? { userId: { in: among } } : {}) },
      _count: { _all: true },
      having: { userId: { _count: { gte: GIVEAWAY_MIN_TRADES } } },
    });
    return new Set(rows.map((r) => r.userId));
  }

  /** Trades d'un compte dans `[start, end)` (page « Concours du mois »). */
  countTrades(userId: string, range: { start: Date; end: Date }): Promise<number> {
    return this.prisma.trade.count({ where: { userId, tradedAt: { gte: range.start, lt: range.end } } });
  }

  /**
   * Éligibles au tirage `pool` à l'instant `now` (activité du mois civil Paris écoulé), triés par
   * identifiant : la liste exacte sur laquelle porte le tirage.
   */
  async eligibleIds(pool: GiveawayPool, now: Date): Promise<string[]> {
    const where = pool === GiveawayPool.FREE ? this.freeWhere(now) : this.premiumWhere(now);
    const candidates = await this.prisma.user.findMany({
      where,
      select: { id: true, stripeCustomerId: true, stripeInterval: true },
      orderBy: { id: 'asc' },
    });
    if (candidates.length === 0) return [];
    const active = await this.activeUserIds(previousParisMonthRange(now), candidates.map((c) => c.id));
    const withActivity = candidates.filter((c) => active.has(c.id));
    if (pool === GiveawayPool.FREE) return withActivity.map((c) => c.id);

    // Premium : factures lues chez Stripe, seulement pour les candidats déjà actifs (peu nombreux).
    const ids: string[] = [];
    for (const c of withActivity) {
      try {
        const facts = await this.stripe.billingFacts(c.stripeCustomerId!);
        if (premiumSeniorityOk(facts, c.stripeInterval, now)) ids.push(c.id);
      } catch (err) {
        // Un client illisible chez Stripe est écarté de ce tirage plutôt que de bloquer tous les autres.
        this.logger.warn(`Factures Stripe illisibles, candidat écarté (user ${c.id}) : ${(err as Error).message}`);
      }
    }
    return ids;
  }
}
