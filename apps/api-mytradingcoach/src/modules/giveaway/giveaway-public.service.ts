import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GiveawayActivation, GiveawayDisplayConsent, GiveawayModeration, GiveawayPool, Role } from '@prisma/client';
import {
  GIVEAWAY_FREE_PRIZE_MONTHS,
  GIVEAWAY_MESSAGE_MAX,
  GIVEAWAY_MIN_ACCOUNT_AGE_DAYS,
  GIVEAWAY_MIN_TRADES,
  GIVEAWAY_PREMIUM_PRIZE_MONTHS,
  GIVEAWAY_PSEUDO_MAX,
  GIVEAWAY_WIN_COOLDOWN_MONTHS,
  giveawayDisplayName,
  giveawayPeriod,
  nextGiveawayDrawAt,
  parisMonthRange,
  shiftGiveawayPeriod,
  type GiveawayAppState,
  type GiveawayMyReason,
  type GiveawayMyWin,
  type GiveawayPublicState,
  type GiveawayPublicWinner,
  type UpdateMyGiveawayWinRequest,
} from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { StripeGiveawayService } from '../stripe/stripe-giveaway.service';
import { GiveawayEligibilityService, premiumSeniorityOk } from './giveaway-eligibility.service';
import { GiveawaySettingsService } from './giveaway-settings.service';
import { safePrizeError } from './giveaway-errors';

const DAY_MS = 24 * 3600_000;
/** Derniers gagnants montrés (page de l'app et landing). */
const WINNERS_SHOWN = 12;
/** État public en cache (landing, une requête par visiteur) : invalidé par la modération. */
export const GIVEAWAY_PUBLIC_CACHE_KEY = 'giveaway:public-state';
const PUBLIC_CACHE_TTL_S = 60;
/** Ancienneté Premium d'un abonné (lecture Stripe) : en cache, une page vue = pas un appel Stripe. */
const SENIORITY_CACHE_TTL_S = 3600;
/** Pseudo Instagram : lettres, chiffres, point et souligné (sans « @ »). */
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Lot B du tirage mensuel (PROMPT-tirage-mensuel) : état public (landing), état de la page
 * « Concours du mois » (statut de l'utilisateur, compteurs, gagnants) et page gagnant. Seules des
 * données affichables sortent : nom selon l'accord, message seulement validé.
 */
@Injectable()
export class GiveawayPublicService {
  private readonly logger = new Logger(GiveawayPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GiveawaySettingsService,
    private readonly eligibility: GiveawayEligibilityService,
    private readonly stripe: StripeGiveawayService,
    private readonly redisService: RedisService,
  ) {}

  /** État public, en cache 60 s (Redis indisponible : recalcul). */
  async publicState(now = new Date()): Promise<GiveawayPublicState> {
    const redis = this.redisService.client;
    const cached = await redis.get(GIVEAWAY_PUBLIC_CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as GiveawayPublicState;
      } catch {
        /* cache illisible : recalcul */
      }
    }
    const state = await this.computePublicState(now);
    await redis.set(GIVEAWAY_PUBLIC_CACHE_KEY, JSON.stringify(state), 'EX', PUBLIC_CACHE_TTL_S).catch(() => undefined);
    return state;
  }

  /** Vide le cache public (modération, consentement, allumage). */
  async invalidatePublicState(): Promise<void> {
    await this.redisService.client.del(GIVEAWAY_PUBLIC_CACHE_KEY).catch(() => undefined);
  }

  async computePublicState(now = new Date()): Promise<GiveawayPublicState> {
    const s = await this.settings.get();
    const [byPool, monthsOffered, draws] = await Promise.all([
      this.prisma.giveawayWin.groupBy({
        by: ['pool'],
        where: { activationStatus: GiveawayActivation.APPLIED },
        _count: { _all: true },
      }),
      this.prisma.giveawayWin.aggregate({
        where: { activationStatus: GiveawayActivation.APPLIED },
        _sum: { prizeMonths: true },
      }),
      this.prisma.giveawayDraw.findMany({
        where: { win: { activationStatus: GiveawayActivation.APPLIED } },
        orderBy: [{ period: 'desc' }, { pool: 'asc' }],
        take: WINNERS_SHOWN,
        include: { win: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    const count = (pool: GiveawayPool) => byPool.find((r) => r.pool === pool)?._count._all ?? 0;
    const winners: GiveawayPublicWinner[] = draws
      .filter((d) => d.win)
      .map((d) => ({
        period: d.period,
        pool: d.pool,
        displayName: giveawayDisplayName(d.win!.displayConsent, d.win!.displayPseudo, d.win!.user?.name ?? null),
        prizeMonths: d.win!.prizeMonths,
        message: d.win!.moderation === GiveawayModeration.VALIDE ? d.win!.message : null,
      }));
    return {
      enabled: s.freeEnabled || s.premiumEnabled,
      free: s.freeEnabled,
      premium: s.premiumEnabled,
      freePrizeMonths: GIVEAWAY_FREE_PRIZE_MONTHS,
      premiumPrizeMonths: GIVEAWAY_PREMIUM_PRIZE_MONTHS,
      minTrades: GIVEAWAY_MIN_TRADES,
      nextDrawAt: nextGiveawayDrawAt(now).toISOString(),
      winnersFree: count(GiveawayPool.FREE),
      winnersPremium: count(GiveawayPool.PREMIUM),
      monthsOffered: monthsOffered._sum.prizeMonths ?? 0,
      winners,
    };
  }

  /** État de la page « Concours du mois » pour un utilisateur connecté. */
  async appState(userId: string, now = new Date()): Promise<GiveawayAppState> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, isDemo: true, isInternal: true, role: true, createdAt: true,
        stripeCustomerId: true, stripeSubscriptionId: true, stripeSubscriptionStatus: true,
        stripeCancelAt: true, stripeInterval: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    const [base, tradesThisMonth] = await Promise.all([
      this.publicState(now),
      this.eligibility.countTrades(userId, parisMonthRange(now)),
    ]);
    const pool =
      user.stripeSubscriptionId && user.stripeSubscriptionStatus === 'active' ? GiveawayPool.PREMIUM : GiveawayPool.FREE;

    if (user.isDemo) {
      // Démo : page visible avec des données d'exemple, jamais de faux gagnant ni de faux message.
      return {
        ...base,
        enabled: true,
        free: true,
        premium: true,
        winnersFree: 0,
        winnersPremium: 0,
        monthsOffered: 0,
        winners: [],
        demo: true,
        me: { pool, reason: tradesThisMonth >= GIVEAWAY_MIN_TRADES ? 'in' : 'need_trades', tradesThisMonth },
        myWin: null,
      };
    }

    const [reason, myWin] = await Promise.all([
      this.reasonFor(user, pool, tradesThisMonth, base, now),
      this.myWin(userId, now),
    ]);
    return { ...base, demo: false, me: { pool, reason, tradesThisMonth }, myWin };
  }

  private async reasonFor(
    user: {
      id: string; isInternal: boolean; role: Role; createdAt: Date;
      stripeCustomerId: string | null; stripeCancelAt: Date | null; stripeInterval: string | null;
    },
    pool: GiveawayPool,
    tradesThisMonth: number,
    base: GiveawayPublicState,
    now: Date,
  ): Promise<GiveawayMyReason> {
    if (user.isInternal || user.role === Role.ADMIN) return 'not_eligible';
    if (pool === GiveawayPool.FREE ? !base.free : !base.premium) return 'pool_off';
    if (await this.recentWinner(user.id, now)) return 'recent_winner';
    if (pool === GiveawayPool.FREE) {
      if (user.role === Role.BETA_TESTER) return 'not_eligible';
      if (user.createdAt.getTime() > now.getTime() - GIVEAWAY_MIN_ACCOUNT_AGE_DAYS * DAY_MS) return 'account_too_recent';
    } else {
      if (user.stripeCancelAt) return 'cancel_scheduled';
      if (!(await this.premiumSeniority(user, now))) return 'premium_too_recent';
    }
    return tradesThisMonth >= GIVEAWAY_MIN_TRADES ? 'in' : 'need_trades';
  }

  /** Gagnant (des deux tirages) pendant la carence, même règle que l'éligibilité. */
  private async recentWinner(userId: string, now: Date): Promise<boolean> {
    const since = shiftGiveawayPeriod(giveawayPeriod(now), -GIVEAWAY_WIN_COOLDOWN_MONTHS);
    const n = await this.prisma.giveawayWin.count({ where: { userId, draw: { period: { gt: since } } } });
    return n > 0;
  }

  /** Ancienneté Premium (factures Stripe), en cache 1 h par utilisateur. Erreur Stripe : « pas encore ». */
  private async premiumSeniority(user: { id: string; stripeCustomerId: string | null; stripeInterval: string | null }, now: Date): Promise<boolean> {
    if (!user.stripeCustomerId) return false;
    const key = `giveaway:seniority:${user.id}`;
    const redis = this.redisService.client;
    const cached = await redis.get(key).catch(() => null);
    if (cached === '1' || cached === '0') return cached === '1';
    try {
      const ok = premiumSeniorityOk(await this.stripe.billingFacts(user.stripeCustomerId), user.stripeInterval, now);
      await redis.set(key, ok ? '1' : '0', 'EX', SENIORITY_CACHE_TTL_S).catch(() => undefined);
      return ok;
    } catch (err) {
      this.logger.warn(`Ancienneté Premium illisible (user ${user.id}) : ${safePrizeError(err)}`);
      return false;
    }
  }

  /** Dernier lot de l'utilisateur encore dans la carence. */
  async myWin(userId: string, now = new Date()): Promise<GiveawayMyWin | null> {
    const since = shiftGiveawayPeriod(giveawayPeriod(now), -GIVEAWAY_WIN_COOLDOWN_MONTHS);
    const win = await this.prisma.giveawayWin.findFirst({
      where: { userId, draw: { period: { gt: since } } },
      orderBy: { createdAt: 'desc' },
      include: { draw: { select: { period: true } } },
    });
    return win ? toMyWin(win) : null;
  }

  /**
   * Réglages du gagnant : affichage, message (≤ 140), accord Instagram. Un message modifié repasse
   * « En attente » (rien d'affiché avant une nouvelle validation). Toujours modifiable ensuite.
   */
  async updateMyWin(userId: string, dto: UpdateMyGiveawayWinRequest, now = new Date()): Promise<GiveawayMyWin> {
    const current = await this.myWin(userId, now);
    if (!current) throw new NotFoundException('Aucun lot gagné.');
    const pseudo = clean(dto.displayPseudo);
    const message = clean(dto.message);
    const handle = clean(dto.instagramHandle)?.replace(/^@/, '') ?? null;
    if (dto.displayConsent === GiveawayDisplayConsent.PSEUDO && !pseudo) {
      throw new BadRequestException('Choisis un pseudo à afficher.');
    }
    if (pseudo && pseudo.length > GIVEAWAY_PSEUDO_MAX) throw new BadRequestException(`Pseudo : ${GIVEAWAY_PSEUDO_MAX} caractères au plus.`);
    if (message && message.length > GIVEAWAY_MESSAGE_MAX) throw new BadRequestException(`Message : ${GIVEAWAY_MESSAGE_MAX} caractères au plus.`);
    if (handle && !INSTAGRAM_RE.test(handle)) throw new BadRequestException('Pseudo Instagram invalide.');

    const messageChanged = message !== current.message;
    const updated = await this.prisma.giveawayWin.update({
      where: { id: current.id },
      data: {
        displayConsent: dto.displayConsent,
        displayPseudo: pseudo,
        message,
        instagramConsent: dto.instagramConsent,
        instagramHandle: dto.instagramConsent ? handle : null,
        ...(messageChanged ? { moderation: GiveawayModeration.EN_ATTENTE, moderatedAt: null } : {}),
      },
      include: { draw: { select: { period: true } } },
    });
    await this.invalidatePublicState();
    return toMyWin(updated);
  }
}

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function toMyWin(w: {
  id: string; pool: GiveawayPool; prizeMonths: number; startsAt: Date; endsAt: Date;
  activationStatus: GiveawayActivation; displayConsent: GiveawayDisplayConsent; displayPseudo: string | null;
  message: string | null; moderation: GiveawayModeration; instagramConsent: boolean; instagramHandle: string | null;
  draw: { period: string };
}): GiveawayMyWin {
  return {
    id: w.id,
    period: w.draw.period,
    pool: w.pool,
    prizeMonths: w.prizeMonths,
    startsAt: w.startsAt.toISOString(),
    endsAt: w.endsAt.toISOString(),
    activationStatus: w.activationStatus,
    displayConsent: w.displayConsent,
    displayPseudo: w.displayPseudo,
    message: w.message,
    moderation: w.moderation,
    instagramConsent: w.instagramConsent,
    instagramHandle: w.instagramHandle,
  };
}
