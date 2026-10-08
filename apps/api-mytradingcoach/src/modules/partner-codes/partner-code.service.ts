import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckoutReservationKind,
  PartnerRedemptionStatus,
  Prisma,
  Role,
  type PartnerCode,
  type PartnerRedemption,
} from '@prisma/client';
import Stripe from 'stripe';
import { PREMIUM_PRICE_EUR } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.client';
import { RESERVATION_TTL_MS } from '../founder-offer/founder-offer.service';
import {
  PARTNER_CODE_PATTERN,
  amountOffCents,
  conditionsLabel,
  discountEndsAt,
  normalizeCode,
  partnerCouponId,
  remainingMonths,
  type BillingInterval,
  type PartnerConditions,
} from './partner-code.util';

/** Verrou transactionnel des utilisations de codes (distinct de celui des places fondateur). */
export const PARTNER_LOCK_KEY = 525_002;
/** Utilisations comptées : remise en cours ou terminée. RELEASED revient au quota. */
const USED_STATUSES: PartnerRedemptionStatus[] = [PartnerRedemptionStatus.ACTIVE, PartnerRedemptionStatus.LOST];

export type PartnerCodeRefusal =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'exhausted'
  | 'already_used'
  | 'subscribed'
  | 'excluded';

/** Message exact du refus : l'utilisateur sait pourquoi, et que le prix normal reste possible. */
export const PARTNER_REFUSALS: Record<PartnerCodeRefusal, string> = {
  not_found: "Ce code partenaire n'existe pas.",
  inactive: "Ce code partenaire n'est plus actif.",
  expired: 'Ce code partenaire a expiré.',
  exhausted: 'Ce code partenaire a atteint son nombre maximum de personnes.',
  already_used: 'Tu as déjà utilisé un code partenaire.',
  subscribed: "Les codes partenaires sont réservés aux personnes qui n'ont jamais été abonnées.",
  excluded: "Ce compte ne peut pas utiliser de code partenaire.",
};

/** Conditions publiques d'un code : ni le nom du partenaire, ni le nombre d'utilisations. */
export type PartnerPublicConditions =
  | { valid: true; code: string; priceMonthlyEur: number; priceAnnualEur: number; durationMonths: number | null; label: string }
  | { valid: false; code: string; reason: PartnerCodeRefusal; message: string };

export interface PartnerCodeInput {
  code: string;
  label: string;
  priceMonthlyEur: number;
  priceAnnualEur: number;
  durationMonths: number | null;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  active?: boolean;
}

type Tx = Prisma.TransactionClient;

/**
 * Codes partenaires (#525) : prix remisé réglable code par code, appliqué côté serveur par un
 * coupon Stripe `amount_off` de l'intervalle choisi (29,00 € / 290,00 € pile). Ne prend aucune
 * place fondateur ; essai 30 j conservé (prix normal remisé) ; une utilisation par personne.
 */
@Injectable()
export class PartnerCodeService {
  private readonly logger = new Logger(PartnerCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  // ── Admin : création, modification, liste ────────────────────────────────────

  async create(input: PartnerCodeInput): Promise<PartnerCode> {
    const code = this.checkInput(input);
    if (await this.prisma.partnerCode.findUnique({ where: { code } })) {
      throw new ConflictException(`Le code ${code} existe déjà.`);
    }
    const coupons = await this.ensureCoupons(input);
    return this.prisma.partnerCode.create({
      data: {
        code,
        label: input.label.trim(),
        priceMonthlyEur: input.priceMonthlyEur,
        priceAnnualEur: input.priceAnnualEur,
        durationMonths: input.durationMonths,
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt,
        active: input.active ?? true,
        stripeCouponMonthlyId: coupons.monthly,
        stripeCouponAnnualId: coupons.annual,
      },
    });
  }

  /**
   * Modification : les FUTURS abonnés ont les nouvelles conditions (nouveaux coupons si le prix
   * ou la durée change) ; ceux qui ont déjà le code gardent les leurs (figées dans la redemption
   * et dans leur abonnement Stripe). Le code lui-même ne se renomme pas.
   */
  async update(id: string, patch: Partial<Omit<PartnerCodeInput, 'code'>>): Promise<PartnerCode> {
    const current = await this.prisma.partnerCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Code partenaire introuvable.');
    const next: PartnerCodeInput = {
      code: current.code,
      label: patch.label ?? current.label,
      priceMonthlyEur: patch.priceMonthlyEur ?? current.priceMonthlyEur,
      priceAnnualEur: patch.priceAnnualEur ?? current.priceAnnualEur,
      durationMonths: patch.durationMonths !== undefined ? patch.durationMonths : current.durationMonths,
      maxRedemptions: patch.maxRedemptions !== undefined ? patch.maxRedemptions : current.maxRedemptions,
      expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : current.expiresAt,
      active: patch.active ?? current.active,
    };
    this.checkInput(next);
    const pricingChanged =
      next.priceMonthlyEur !== current.priceMonthlyEur ||
      next.priceAnnualEur !== current.priceAnnualEur ||
      next.durationMonths !== current.durationMonths;
    const coupons = pricingChanged
      ? await this.ensureCoupons(next)
      : { monthly: current.stripeCouponMonthlyId, annual: current.stripeCouponAnnualId };
    return this.prisma.partnerCode.update({
      where: { id },
      data: {
        label: next.label.trim(),
        priceMonthlyEur: next.priceMonthlyEur,
        priceAnnualEur: next.priceAnnualEur,
        durationMonths: next.durationMonths,
        maxRedemptions: next.maxRedemptions,
        expiresAt: next.expiresAt,
        active: next.active,
        stripeCouponMonthlyId: coupons.monthly,
        stripeCouponAnnualId: coupons.annual,
      },
    });
  }

  /** Liste admin avec « utilisés / max » (utilisations comptées + checkouts en cours). */
  async list(now = new Date()) {
    const [codes, used, reserved] = await Promise.all([
      this.prisma.partnerCode.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.partnerRedemption.groupBy({
        by: ['partnerCodeId', 'status'],
        _count: { _all: true },
      }),
      this.prisma.checkoutReservation.groupBy({
        by: ['partnerCodeId'],
        where: { kind: CheckoutReservationKind.PARTNER, expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);
    return codes.map((c) => {
      const rows = used.filter((u) => u.partnerCodeId === c.id);
      const count = (s: PartnerRedemptionStatus) => rows.find((r) => r.status === s)?._count._all ?? 0;
      return {
        ...c,
        conditions: conditionsLabel(c),
        used: count(PartnerRedemptionStatus.ACTIVE) + count(PartnerRedemptionStatus.LOST),
        activeSubscribers: count(PartnerRedemptionStatus.ACTIVE),
        lost: count(PartnerRedemptionStatus.LOST),
        released: count(PartnerRedemptionStatus.RELEASED),
        pendingCheckouts: reserved.find((r) => r.partnerCodeId === c.id)?._count._all ?? 0,
      };
    });
  }

  /** Abonnés d'un code (fiche admin). */
  async users(id: string) {
    const code = await this.prisma.partnerCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Code partenaire introuvable.');
    const redemptions = await this.prisma.partnerRedemption.findMany({
      where: { partnerCodeId: id },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true, stripeInterval: true } } },
    });
    return { code: code.code, label: code.label, redemptions };
  }

  // ── Validation (publique et au checkout) ─────────────────────────────────────

  /**
   * Validité d'un code, et pour un utilisateur donné son droit de l'utiliser. Chaque refus a sa
   * raison précise. Sans `userId` (landing), seules les règles du code sont vérifiées.
   */
  async validate(raw: string, userId: string | null = null, now = new Date()): Promise<PartnerPublicConditions> {
    const code = normalizeCode(raw);
    const refuse = (reason: PartnerCodeRefusal): PartnerPublicConditions => ({
      valid: false, code, reason, message: PARTNER_REFUSALS[reason],
    });
    if (!PARTNER_CODE_PATTERN.test(code)) return refuse('not_found');
    const found = await this.prisma.partnerCode.findUnique({ where: { code } });
    if (!found) return refuse('not_found');
    const codeRefusal = await this.codeRefusal(found, this.prisma, now);
    if (codeRefusal) return refuse(codeRefusal);
    if (userId) {
      const userRefusal = await this.userRefusal(userId);
      if (userRefusal) return refuse(userRefusal);
    }
    return {
      valid: true,
      code,
      priceMonthlyEur: found.priceMonthlyEur,
      priceAnnualEur: found.priceAnnualEur,
      durationMonths: found.durationMonths,
      label: conditionsLabel(found),
    };
  }

  /** Utilisations comptées + réservations en cours d'un code (une requête indexée chacune). */
  async usedCount(codeId: string, tx: Tx | PrismaService = this.prisma, now = new Date()): Promise<number> {
    const [redemptions, reservations] = await Promise.all([
      tx.partnerRedemption.count({ where: { partnerCodeId: codeId, status: { in: USED_STATUSES } } }),
      tx.checkoutReservation.count({
        where: { partnerCodeId: codeId, kind: CheckoutReservationKind.PARTNER, expiresAt: { gt: now } },
      }),
    ]);
    return redemptions + reservations;
  }

  private async codeRefusal(c: PartnerCode, tx: Tx | PrismaService, now: Date): Promise<PartnerCodeRefusal | null> {
    if (!c.active) return 'inactive';
    if (c.expiresAt && c.expiresAt <= now) return 'expired';
    if (c.maxRedemptions !== null && (await this.usedCount(c.id, tx, now)) >= c.maxRedemptions) return 'exhausted';
    return null;
  }

  /**
   * Une utilisation par personne, et seulement si elle n'a jamais été abonnée (aucun abonnement
   * Stripe passé ou en cours, jamais fondateur). Un mois offert hors Stripe ne compte pas.
   */
  private async userRefusal(userId: string): Promise<PartnerCodeRefusal | null> {
    const [user, redemption, seat] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isDemo: true, stripeSubscriptionId: true, subscriptionCanceledAt: true },
      }),
      this.prisma.partnerRedemption.findUnique({ where: { userId } }),
      this.prisma.founderSeat.findUnique({ where: { userId } }),
    ]);
    if (!user || user.isDemo || user.role === Role.ADMIN) return 'excluded';
    if (redemption) return 'already_used';
    if (user.stripeSubscriptionId || user.subscriptionCanceledAt || seat) return 'subscribed';
    return null;
  }

  // ── Checkout : réservation, puis utilisation au 1er paiement ─────────────────

  /**
   * Réserve une utilisation du code pour la durée du checkout, sous verrou Postgres : deux
   * checkouts simultanés pour la dernière utilisation → un seul passe. Lève avec la raison
   * précise si le code ou l'utilisateur n'est plus éligible.
   */
  async reserve(userId: string, raw: string, interval: BillingInterval, cta: string | null, now = new Date()) {
    const code = normalizeCode(raw);
    const userRefusal = await this.userRefusal(userId);
    if (userRefusal) throw new BadRequestException(PARTNER_REFUSALS[userRefusal]);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_LOCK_KEY})`;
      await tx.checkoutReservation.deleteMany({ where: { userId, kind: CheckoutReservationKind.PARTNER } });
      const found = await tx.partnerCode.findUnique({ where: { code } });
      if (!found) throw new BadRequestException(PARTNER_REFUSALS.not_found);
      const refusal = await this.codeRefusal(found, tx, now);
      if (refusal) throw new ConflictException(PARTNER_REFUSALS[refusal]);
      const reservation = await tx.checkoutReservation.create({
        data: {
          kind: CheckoutReservationKind.PARTNER,
          userId,
          partnerCodeId: found.id,
          interval,
          cta,
          expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
        },
      });
      return { reservation, partnerCode: found };
    });
  }

  /** Coupon Stripe du code pour l'intervalle choisi au checkout. */
  couponFor(c: PartnerCode, interval: BillingInterval): string {
    return interval === 'year' ? c.stripeCouponAnnualId : c.stripeCouponMonthlyId;
  }

  /**
   * Utilisation comptée au 1er `invoice.payment_succeeded` (facture à 0 € d'un essai comprise) :
   * conditions FIGÉES dans la redemption. Idempotent (une par personne). Sans réservation valide
   * (webhook très tardif), l'utilisation est quand même enregistrée : la remise est déjà dans
   * l'abonnement Stripe, et un dépassement d'une unité est journalisé. Le coupon enregistré est
   * celui de l'intervalle payé.
   */
  async claim(args: {
    userId: string;
    code: string;
    stripeSubscriptionId: string;
    interval: BillingInterval;
    cta?: string | null;
  }): Promise<PartnerRedemption | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PARTNER_LOCK_KEY})`;
      const existing = await tx.partnerRedemption.findUnique({ where: { userId: args.userId } });
      if (existing) return existing;
      const found = await tx.partnerCode.findUnique({ where: { code: normalizeCode(args.code) } });
      if (!found) {
        this.logger.error(`[PARTENAIRE] Code ${args.code} introuvable au paiement | user: ${args.userId}`);
        return null;
      }
      const reservation = await tx.checkoutReservation.findFirst({
        where: { userId: args.userId, kind: CheckoutReservationKind.PARTNER, partnerCodeId: found.id },
      });
      if (!reservation && found.maxRedemptions !== null) {
        const used = await tx.partnerRedemption.count({
          where: { partnerCodeId: found.id, status: { in: USED_STATUSES } },
        });
        if (used >= found.maxRedemptions) {
          this.logger.warn(`[PARTENAIRE] ${found.code} : utilisation au-delà du quota (réservation expirée) | user: ${args.userId}`);
        }
      }
      await tx.checkoutReservation.deleteMany({ where: { userId: args.userId, kind: CheckoutReservationKind.PARTNER } });
      return tx.partnerRedemption.create({
        data: {
          partnerCodeId: found.id,
          userId: args.userId,
          priceMonthlyEur: found.priceMonthlyEur,
          priceAnnualEur: found.priceAnnualEur,
          durationMonths: found.durationMonths,
          stripeCouponId: this.couponFor(found, args.interval),
          stripeSubscriptionId: args.stripeSubscriptionId,
          cta: args.cta ?? reservation?.cta ?? null,
        },
      });
    });
  }

  /** Abonnement terminé : remise perdue (définitif), l'utilisation reste comptée. */
  async markLost(stripeSubscriptionId: string, now = new Date()) {
    return this.end(stripeSubscriptionId, PartnerRedemptionStatus.LOST, now);
  }

  /** Premier paiement remboursé intégralement (quel que soit le délai) ou en échec : l'utilisation revient au quota. */
  async release(stripeSubscriptionId: string, now = new Date()) {
    return this.end(stripeSubscriptionId, PartnerRedemptionStatus.RELEASED, now);
  }

  private async end(stripeSubscriptionId: string, status: PartnerRedemptionStatus, now: Date) {
    const r = await this.prisma.partnerRedemption.findFirst({
      where: { stripeSubscriptionId, status: PartnerRedemptionStatus.ACTIVE },
    });
    if (!r) return null;
    this.logger.log(`[PARTENAIRE] Utilisation ${r.id} → ${status} | sub: ${stripeSubscriptionId}`);
    return this.prisma.partnerRedemption.update({ where: { id: r.id }, data: { status, endedAt: now } });
  }

  /** Remise partenaire active d'un abonnement (ou null). */
  activeForSubscription(stripeSubscriptionId: string) {
    return this.prisma.partnerRedemption.findFirst({
      where: { stripeSubscriptionId, status: PartnerRedemptionStatus.ACTIVE },
    });
  }


  /**
   * Changement d'intervalle : coupon de l'AUTRE intervalle aux conditions FIGÉES de l'abonné
   * (pas celles du code aujourd'hui), pour les mois de remise qui restent. `null` = plus de remise.
   */
  async couponForIntervalChange(r: PartnerRedemption, interval: BillingInterval, now = new Date()): Promise<string | null> {
    const remaining = remainingMonths(r.createdAt, r.durationMonths, now);
    if (remaining === 0) return null;
    const conditions: PartnerConditions = {
      priceMonthlyEur: r.priceMonthlyEur, priceAnnualEur: r.priceAnnualEur, durationMonths: remaining,
    };
    const amountOff = amountOffCents(conditions, interval);
    const id = await this.ensureCoupon(amountOff, remaining);
    await this.prisma.partnerRedemption.update({ where: { id: r.id }, data: { stripeCouponId: id } });
    return id;
  }

  /** Remise partenaire exposée par `/users/me` (code, conditions, fin). */
  async statusFor(userId: string) {
    const r = await this.prisma.partnerRedemption.findUnique({
      where: { userId },
      include: { partnerCode: { select: { code: true } } },
    });
    if (!r || r.status !== PartnerRedemptionStatus.ACTIVE) return { partnerCode: null };
    return {
      partnerCode: {
        code: r.partnerCode.code,
        priceMonthlyEur: r.priceMonthlyEur,
        priceAnnualEur: r.priceAnnualEur,
        durationMonths: r.durationMonths,
        since: r.createdAt,
        endsAt: discountEndsAt(r.createdAt, r.durationMonths),
        label: conditionsLabel(r),
      },
    };
  }

  // ── Coupons Stripe ────────────────────────────────────────────────────────────

  private checkInput(input: PartnerCodeInput): string {
    const code = normalizeCode(input.code);
    if (!PARTNER_CODE_PATTERN.test(code)) {
      throw new BadRequestException('Code : 3 à 20 caractères, lettres, chiffres, tiret ou souligné.');
    }
    const priceOk = (v: number, max: number) => Number.isInteger(v) && v >= 1 && v < max;
    if (!priceOk(input.priceMonthlyEur, PREMIUM_PRICE_EUR.monthly) || !priceOk(input.priceAnnualEur, PREMIUM_PRICE_EUR.annual)) {
      throw new BadRequestException(
        `Prix remisés : entre 1 € et ${PREMIUM_PRICE_EUR.monthly - 1} €/mois, ${PREMIUM_PRICE_EUR.annual - 1} €/an (entiers).`,
      );
    }
    if (input.durationMonths !== null && !(Number.isInteger(input.durationMonths) && input.durationMonths >= 1)) {
      throw new BadRequestException('Durée : « à vie » ou un nombre de mois ≥ 1.');
    }
    if (input.maxRedemptions !== null && !(Number.isInteger(input.maxRedemptions) && input.maxRedemptions >= 1)) {
      throw new BadRequestException('Nombre de personnes : « illimité » ou un nombre ≥ 1.');
    }
    return code;
  }

  private async ensureCoupons(c: PartnerConditions): Promise<{ monthly: string; annual: string }> {
    const [monthly, annual] = await Promise.all([
      this.ensureCoupon(amountOffCents(c, 'month'), c.durationMonths),
      this.ensureCoupon(amountOffCents(c, 'year'), c.durationMonths),
    ]);
    return { monthly, annual };
  }

  /**
   * Coupon `amount_off` en EUR, retrouvé par son identifiant déterministe ou créé. `forever` à
   * vie ; `repeating` + `duration_in_months` sinon (sur l'annuel : chaque facture émise pendant
   * ces N mois est remisée, soit la 1re année seulement si N ≤ 12).
   */
  private async ensureCoupon(amountOff: number, durationMonths: number | null): Promise<string> {
    const id = partnerCouponId(amountOff, durationMonths);
    const existing = await this.stripe.coupons.retrieve(id).catch(() => null);
    if (existing && !existing.deleted) return id;
    const euros = (amountOff / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0 });
    await this.stripe.coupons.create({
      id,
      amount_off: amountOff,
      currency: 'eur',
      name: durationMonths === null ? `Partenaire −${euros} € à vie` : `Partenaire −${euros} € · ${durationMonths} mois`,
      ...(durationMonths === null
        ? { duration: 'forever' as const }
        : { duration: 'repeating' as const, duration_in_months: durationMonths }),
      metadata: { kind: 'partner' },
    });
    return id;
  }
}
