import { ConflictException, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CheckoutReservationKind,
  FounderSeatStatus,
  Prisma,
  Role,
  type FounderSeat,
} from '@prisma/client';
import { FOUNDER_MILESTONES, FOUNDER_OFFER, FOUNDER_REFUND_DAYS } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { ResendService } from '../resend/resend.service';

/** Verrou transactionnel Postgres de l'offre (places ET numéros) : clé fixe, propre à l'offre. */
export const FOUNDER_LOCK_KEY = 525_001;
/**
 * Durée d'une réservation : la session Checkout vit 30 min (minimum Stripe, `expires_at`), plus
 * 5 min de marge pour le webhook `invoice.payment_succeeded` qui arrive après le paiement.
 */
export const RESERVATION_TTL_MS = 35 * 60_000;
/** Session Checkout fondateur : 30 min, alignée sur la réservation. */
export const CHECKOUT_TTL_MS = 30 * 60_000;
const SEATS_LEFT_CACHE_KEY = 'founder:seats-left';
const SEATS_LEFT_CACHE_TTL_S = 30;
/** Places prises : abonnement en cours ou terminé (« 200 personnes »). Remboursé / libéré = rendu. */
const TAKEN_STATUSES: FounderSeatStatus[] = [FounderSeatStatus.ACTIVE, FounderSeatStatus.LOST];

export type FounderInterval = 'month' | 'year';

export type FounderIneligibility =
  | 'closed'
  | 'sold_out'
  | 'excluded'
  | 'already_founder'
  | 'tariff_lost'
  | 'subscribed';

export interface FounderEligibility {
  eligible: boolean;
  reason: FounderIneligibility | null;
}

/** Utilisateur tel que l'éligibilité le lit (sous-ensemble de `User`). */
export interface FounderCandidate {
  id: string;
  role: Role;
  isDemo: boolean;
  stripeSubscriptionStatus: string | null;
  stripePriceId: string | null;
}

export interface FounderPublicState {
  open: boolean;
  /**
   * L'offre a été ouverte puis s'est arrêtée (complète ou date de fin passée) : la landing dit
   * « offre clôturée, les fondateurs gardent leur tarif ». Faux tant qu'elle n'a jamais ouvert.
   */
  ended: boolean;
  seatsTotal: number;
  seatsLeft: number;
  priceMonthlyEur: number;
  priceAnnualEur: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Offre fondateur (#525) : 200 places à 29 €/mois ou 290 €/an, prix bloqué à vie.
 *
 * ANTI-SURVENTE : toute prise de place passe par une transaction qui commence par
 * `pg_advisory_xact_lock(FOUNDER_LOCK_KEY)`. Les transactions concurrentes s'y alignent : le compte
 * « places prises + réservations non expirées » est donc lu et écrit sans course possible.
 * - checkout : `reserve` → réservation de 35 min (session Stripe de 30 min) ;
 * - premier paiement : `claimSeat` → numéro = plus grand numéro JAMAIS attribué + 1, la ligne
 *   `FounderSeat` n'étant jamais supprimée (un numéro n'est jamais réattribué).
 * Personne n'est prélevé sans place : la session Stripe expire avant la réservation, et `claimSeat`
 * refuse explicitement (`null`) s'il n'y a ni réservation ni place, l'appelant rembourse.
 */
@Injectable()
export class FounderOfferService {
  private readonly logger = new Logger(FounderOfferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly resend?: ResendService,
  ) {}

  // ── Configuration ──────────────────────────────────────────────────────────

  async getConfig() {
    return (
      (await this.prisma.founderOfferConfig.findUnique({ where: { id: 1 } })) ??
      (await this.prisma.founderOfferConfig.create({ data: { id: 1, open: false } }))
    );
  }

  async setConfig(input: { open?: boolean; endsAt?: Date | null }) {
    const data: Prisma.FounderOfferConfigUpdateInput = {};
    if (input.open !== undefined) data.open = input.open;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;
    await this.getConfig();
    const config = await this.prisma.founderOfferConfig.update({ where: { id: 1 }, data });
    await this.invalidateSeatsLeft();
    this.logger.log(`Offre fondateur : open=${config.open}, endsAt=${config.endsAt?.toISOString() ?? 'null'}`);
    return config;
  }

  // ── Places ─────────────────────────────────────────────────────────────────

  /** Places prises + réservations en cours. Sous verrou si `tx` vient de `withLock`. */
  async seatsTaken(tx: Tx | PrismaService = this.prisma, now = new Date()): Promise<number> {
    const [seats, reservations] = await Promise.all([
      tx.founderSeat.count({ where: { status: { in: TAKEN_STATUSES } } }),
      tx.checkoutReservation.count({
        where: { kind: CheckoutReservationKind.FOUNDER, expiresAt: { gt: now } },
      }),
    ]);
    return seats + reservations;
  }

  /** Places restantes, jamais négatif. Cache 30 s, invalidé à chaque prise / libération. */
  async seatsLeft(): Promise<number> {
    const cached = await this.redis.client.get(SEATS_LEFT_CACHE_KEY).catch(() => null);
    if (cached !== null && /^\d+$/.test(cached)) return Number(cached);
    const left = Math.max(0, FOUNDER_OFFER.seats - (await this.seatsTaken()));
    await this.redis.client.set(SEATS_LEFT_CACHE_KEY, String(left), 'EX', SEATS_LEFT_CACHE_TTL_S).catch(() => undefined);
    return left;
  }

  async invalidateSeatsLeft(): Promise<void> {
    await this.redis.client.del(SEATS_LEFT_CACHE_KEY).catch(() => undefined);
  }

  /** Offre ouverte : interrupteur, date de fin, places restantes. */
  async isOpen(now = new Date()): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.open) return false;
    if (config.endsAt && config.endsAt <= now) return false;
    return (await this.seatsLeft()) > 0;
  }

  /** Route publique : rien de personnel, et `open: false` dès que l'offre ne vend plus. */
  async publicState(now = new Date()): Promise<FounderPublicState> {
    const [config, seatsLeft] = await Promise.all([this.getConfig(), this.seatsLeft()]);
    const ended = config.open && (seatsLeft === 0 || (!!config.endsAt && config.endsAt <= now));
    return {
      open: config.open && !ended,
      ended,
      seatsTotal: FOUNDER_OFFER.seats,
      seatsLeft,
      priceMonthlyEur: FOUNDER_OFFER.priceMonthlyEur,
      priceAnnualEur: FOUNDER_OFFER.priceAnnualEur,
    };
  }

  // ── Éligibilité ────────────────────────────────────────────────────────────

  /**
   * Éligible : offre ouverte, pas démo / ADMIN / BETA_TESTER, jamais eu de place (perdue ou
   * remboursée = tarif perdu définitivement), et pas d'abonnement payant en cours. Un essai Stripe
   * au prix normal (`trialing`) ou un mois offert (sans abonnement) PEUT basculer.
   */
  async eligibility(user: FounderCandidate, founderPriceIds: string[]): Promise<FounderEligibility> {
    if (user.isDemo || user.role === Role.ADMIN || user.role === Role.BETA_TESTER) {
      return { eligible: false, reason: 'excluded' };
    }
    const seat = await this.prisma.founderSeat.findUnique({ where: { userId: user.id } });
    if (seat) {
      return {
        eligible: false,
        reason: seat.status === FounderSeatStatus.ACTIVE ? 'already_founder' : 'tariff_lost',
      };
    }
    const paying =
      user.stripeSubscriptionStatus !== null &&
      ['active', 'past_due', 'unpaid'].includes(user.stripeSubscriptionStatus) &&
      !founderPriceIds.includes(user.stripePriceId ?? '');
    if (paying) return { eligible: false, reason: 'subscribed' };
    const config = await this.getConfig();
    if (!config.open || (config.endsAt && config.endsAt <= new Date())) {
      return { eligible: false, reason: 'closed' };
    }
    if ((await this.seatsLeft()) <= 0) return { eligible: false, reason: 'sold_out' };
    return { eligible: true, reason: null };
  }

  /** Statut fondateur exposé par `/users/me` (place, intervalle, éligibilité et raison). */
  async statusFor(userId: string, founderPriceIds: string[]) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isDemo: true, stripeSubscriptionStatus: true, stripePriceId: true },
    });
    if (!user) return null;
    const [seat, elig] = await Promise.all([
      this.prisma.founderSeat.findUnique({ where: { userId: user.id } }),
      this.eligibility(user, founderPriceIds),
    ]);
    return {
      isFounder: seat?.status === FounderSeatStatus.ACTIVE,
      founderNumber: seat?.status === FounderSeatStatus.ACTIVE ? seat.number : null,
      founderStatus: seat?.status ?? null,
      founderInterval: seat?.interval ?? null,
      founderSince: seat?.takenAt ?? null,
      founderEligible: elig.eligible,
      founderIneligibleReason: elig.reason,
    };
  }

  // ── Réservation (checkout) et prise de place (1er paiement) ───────────────────

  /** Exécute `fn` sous le verrou transactionnel de l'offre. */
  private withLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOUNDER_LOCK_KEY})`;
      return fn(tx);
    });
  }

  /**
   * Réserve une place le temps du Checkout. Une réservation déjà en cours pour ce user est
   * remplacée (un seul Checkout fondateur à la fois). 409 s'il n'y a plus de place.
   */
  async reserve(userId: string, interval: FounderInterval, cta: string | null, now = new Date()) {
    const reservation = await this.withLock(async (tx) => {
      await tx.checkoutReservation.deleteMany({
        where: { userId, kind: CheckoutReservationKind.FOUNDER },
      });
      if ((await this.seatsTaken(tx, now)) >= FOUNDER_OFFER.seats) {
        throw new ConflictException(
          "Il n'y a plus de place fondateur. Tu peux toujours passer Premium au prix normal.",
        );
      }
      return tx.checkoutReservation.create({
        data: {
          kind: CheckoutReservationKind.FOUNDER,
          userId,
          interval,
          cta,
          expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
        },
      });
    });
    await this.invalidateSeatsLeft();
    return reservation;
  }

  async attachSession(reservationId: string, stripeSessionId: string): Promise<void> {
    await this.prisma.checkoutReservation.update({
      where: { id: reservationId },
      data: { stripeSessionId },
    });
  }

  /** La réservation liée à cette session Checkout est-elle encore valide ? */
  async hasValidReservation(stripeSessionId: string, now = new Date()): Promise<boolean> {
    const r = await this.prisma.checkoutReservation.findUnique({ where: { stripeSessionId } });
    return !!r && r.expiresAt > now;
  }

  /** Session Checkout abandonnée, expirée ou remplacée : la réservation rend sa place. */
  async releaseReservation(where: { id?: string; stripeSessionId?: string }): Promise<void> {
    if (!where.id && !where.stripeSessionId) return;
    const { count } = await this.prisma.checkoutReservation.deleteMany({
      where: where.id ? { id: where.id } : { stripeSessionId: where.stripeSessionId },
    });
    if (count) await this.invalidateSeatsLeft();
  }

  /**
   * Premier paiement réussi au tarif fondateur : place prise, numéro attribué. Idempotent (un
   * webhook rejoué renvoie la place existante). `null` = ni réservation ni place libre : l'appelant
   * doit rembourser et annuler (cas théorique, jamais de prélèvement fondateur sans place).
   */
  async claimSeat(args: {
    userId: string;
    interval: FounderInterval;
    stripeSubscriptionId: string;
    cta?: string | null;
    now?: Date;
  }): Promise<FounderSeat | null> {
    const now = args.now ?? new Date();
    const result = await this.withLock(async (tx) => {
      const existing = await tx.founderSeat.findUnique({ where: { userId: args.userId } });
      if (existing) return { seat: existing, created: false };

      const reservation = await tx.checkoutReservation.findFirst({
        where: { userId: args.userId, kind: CheckoutReservationKind.FOUNDER },
        orderBy: { createdAt: 'desc' },
      });
      // Sans réservation encore valide, la place doit être libre « à froid ».
      const hasValidReservation = !!reservation && reservation.expiresAt > now;
      if (!hasValidReservation && (await this.seatsTaken(tx, now)) >= FOUNDER_OFFER.seats) {
        return { seat: null, created: false };
      }
      const last = await tx.founderSeat.aggregate({ _max: { number: true } });
      const seat = await tx.founderSeat.create({
        data: {
          number: (last._max.number ?? 0) + 1,
          userId: args.userId,
          interval: args.interval,
          cta: reservation?.cta ?? args.cta ?? null,
          stripeSubscriptionId: args.stripeSubscriptionId,
          takenAt: now,
        },
      });
      await tx.checkoutReservation.deleteMany({
        where: { userId: args.userId, kind: CheckoutReservationKind.FOUNDER },
      });
      // Paliers décidés SOUS le verrou : deux paiements simultanés ne notifient pas deux fois.
      return { seat, created: true, milestones: await this.markMilestones(tx) };
    });
    await this.invalidateSeatsLeft();
    if (result.created && result.seat) {
      this.logger.log(`Fondateur n° ${result.seat.number} | user ${args.userId}`);
      const reached = 'milestones' in result ? result.milestones : null;
      if (reached) {
        await this.resend
          ?.sendAdminAlert(
            `Offre fondateur : ${reached.top} places prises sur ${FOUNDER_OFFER.seats}`,
            `Palier atteint : ${reached.taken} / ${FOUNDER_OFFER.seats} places fondateur prises.`,
          )
          .catch((err: Error) => this.logger.warn(`Notification de palier non envoyée : ${err.message}`));
      }
    }
    return result.seat;
  }

  /** Changement mensuel ↔ annuel : même place, même numéro. */
  async updateInterval(userId: string, interval: FounderInterval): Promise<void> {
    await this.prisma.founderSeat.updateMany({
      where: { userId, status: FounderSeatStatus.ACTIVE, interval: { not: interval } },
      data: { interval },
    });
  }

  /** Abonnement réellement terminé : tarif perdu, la place reste prise. */
  async markLost(stripeSubscriptionId: string, now = new Date()): Promise<FounderSeat | null> {
    const seat = await this.prisma.founderSeat.findFirst({
      where: { stripeSubscriptionId, status: FounderSeatStatus.ACTIVE },
    });
    if (!seat) return null;
    const updated = await this.prisma.founderSeat.update({
      where: { number: seat.number },
      data: { status: FounderSeatStatus.LOST, endedAt: now },
    });
    this.logger.log(`Fondateur n° ${seat.number} : tarif perdu (abonnement terminé)`);
    return updated;
  }

  /**
   * Remboursement du PREMIER paiement dans les 14 jours : tarif perdu ET place rendue. Hors délai,
   * ou place déjà terminée, rien ne change (`null`).
   */
  async refundWithinWindow(userId: string, now = new Date()): Promise<FounderSeat | null> {
    const seat = await this.prisma.founderSeat.findUnique({ where: { userId } });
    if (!seat || seat.status !== FounderSeatStatus.ACTIVE) return null;
    if (now.getTime() - seat.takenAt.getTime() > FOUNDER_REFUND_DAYS * 86_400_000) return null;
    const updated = await this.prisma.founderSeat.update({
      where: { number: seat.number },
      data: { status: FounderSeatStatus.REFUNDED, endedAt: now },
    });
    await this.invalidateSeatsLeft();
    this.logger.log(`Fondateur n° ${seat.number} : remboursé sous ${FOUNDER_REFUND_DAYS} jours, place rendue`);
    return updated;
  }

  // ── Paliers ────────────────────────────────────────────────────────────────

  /**
   * Paliers (50, 100, 150, 190, 200 places prises) nouvellement atteints : marqués notifiés dans la
   * même transaction que la prise de place. Renvoie le plus haut, ou `null` s'il n'y en a pas.
   */
  private async markMilestones(tx: Tx): Promise<{ top: number; taken: number } | null> {
    const taken = await tx.founderSeat.count({ where: { status: { in: TAKEN_STATUSES } } });
    const config = await tx.founderOfferConfig.findUnique({ where: { id: 1 } });
    const notified = config?.notifiedMilestones ?? [];
    const due = FOUNDER_MILESTONES.filter((m) => taken >= m && !notified.includes(m));
    if (!due.length) return null;
    await tx.founderOfferConfig.upsert({
      where: { id: 1 },
      create: { id: 1, notifiedMilestones: [...due] },
      update: { notifiedMilestones: [...notified, ...due] },
    });
    return { top: Math.max(...due), taken };
  }
}
