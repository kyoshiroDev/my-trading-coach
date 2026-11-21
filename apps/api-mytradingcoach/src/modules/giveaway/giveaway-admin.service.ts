import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GiveawayActivation, GiveawayModeration, GiveawayPool, GiveawaySettings } from '@prisma/client';
import {
  giveawayDisplayName,
  nextGiveawayDrawAt,
  type AdminGiveawayData,
  type AdminGiveawayDrawRow,
  type AdminGiveawayPoolState,
  type AdminGiveawayWin,
  type AdminGiveawaySettingsResponse,
} from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { GiveawayDrawService, type DrawOutcome } from './giveaway-draw.service';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { GiveawayPrizeService } from './giveaway-prize.service';
import { GiveawaySettingsService } from './giveaway-settings.service';
import { GIVEAWAY_PUBLIC_CACHE_KEY } from './giveaway-public.service';

const HISTORY_LIMIT = 48;
/**
 * Nombre d'éligibles affiché (pas celui du tirage, toujours recalculé) : en cache, le tirage Premium
 * relit les factures Stripe de chaque candidat.
 */
const ELIGIBLE_CACHE_TTL_S = 15 * 60;

/** Onglet admin « Tirages » : interrupteurs, historique, modération, relance d'une attribution. */
@Injectable()
export class GiveawayAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GiveawaySettingsService,
    private readonly eligibility: GiveawayEligibilityService,
    private readonly draws: GiveawayDrawService,
    private readonly prizes: GiveawayPrizeService,
    private readonly redisService: RedisService,
  ) {}

  /** Éligibles « si le tirage avait lieu maintenant », en cache 15 min (Redis indisponible : recalcul). */
  private async eligibleNowCached(pool: GiveawayPool, now: Date): Promise<number> {
    const key = `giveaway:eligible-now:${pool}`;
    const redis = this.redisService.client;
    const cached = await redis.get(key).catch(() => null);
    if (cached !== null && Number.isFinite(Number(cached))) return Number(cached);
    const count = (await this.eligibility.eligibleIds(pool, now)).length;
    await redis.set(key, String(count), 'EX', ELIGIBLE_CACHE_TTL_S).catch(() => undefined);
    return count;
  }

  async data(now = new Date()): Promise<AdminGiveawayData> {
    const s = await this.settings.get();
    const [free, premium, history] = await Promise.all([
      this.poolState(GiveawayPool.FREE, s, now),
      this.poolState(GiveawayPool.PREMIUM, s, now),
      this.history(),
    ]);
    return {
      free,
      premium,
      nextDrawAt: nextGiveawayDrawAt(now).toISOString(),
      manualDrawAvailable: this.settings.manualDrawAvailable(),
      activationAvailable: this.settings.activationAvailable(),
      history,
    };
  }

  async setEnabled(pool: GiveawayPool, enabled: boolean): Promise<AdminGiveawaySettingsResponse> {
    const announcementsQueued = await this.settings.setEnabled(pool, enabled);
    await this.invalidatePublic();
    const s = await this.settings.get();
    return { state: await this.poolState(pool, s, new Date()), announcementsQueued };
  }

  /** Valider ou refuser le message d'un gagnant : rien ne s'affiche dans l'app avant « Valider ». */
  async moderate(winId: string, moderation: GiveawayModeration): Promise<AdminGiveawayWin | null> {
    const { count } = await this.prisma.giveawayWin.updateMany({
      where: { id: winId },
      data: { moderation, moderatedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Lot introuvable.');
    await this.invalidatePublic(); // message validé ou refusé : visible ou retiré dans la minute
    return (await this.history(winId))[0]?.win ?? null;
  }

  /** « Relancer l'attribution » d'un lot FAILED (avoir Stripe : même clé, donc sans doublon). */
  async retry(winId: string): Promise<AdminGiveawayWin | null> {
    const win = await this.prisma.giveawayWin.findUnique({ where: { id: winId }, select: { activationStatus: true } });
    if (!win) throw new NotFoundException('Lot introuvable.');
    if (win.activationStatus !== GiveawayActivation.FAILED) {
      throw new ConflictException('Seul un lot en échec peut être relancé.');
    }
    await this.prizes.apply(winId);
    const rows = await this.history(winId);
    return rows[0]?.win ?? null;
  }

  /** État public (landing, page de l'app) en cache 60 s : vidé après un changement de l'admin. */
  private async invalidatePublic(): Promise<void> {
    await this.redisService.client.del(GIVEAWAY_PUBLIC_CACHE_KEY).catch(() => undefined);
  }

  /** « Tirer maintenant » : hors prod seulement (`GIVEAWAY_MANUAL_DRAW=true`). */
  async drawNow(pool: GiveawayPool): Promise<DrawOutcome> {
    if (!this.settings.manualDrawAvailable()) throw new ForbiddenException('Tirage manuel indisponible.');
    return this.draws.draw(pool);
  }

  private async poolState(pool: GiveawayPool, s: GiveawaySettings, now: Date): Promise<AdminGiveawayPoolState> {
    const free = pool === GiveawayPool.FREE;
    const [eligibleNow, announceAudience] = await Promise.all([
      this.eligibleNowCached(pool, now),
      this.settings.announceAudienceCount(pool),
    ]);
    const enabledAt = free ? s.freeEnabledAt : s.premiumEnabledAt;
    const announcedAt = free ? s.freeAnnouncedAt : s.premiumAnnouncedAt;
    return {
      pool,
      enabled: free ? s.freeEnabled : s.premiumEnabled,
      enabledAt: enabledAt?.toISOString() ?? null,
      announcedAt: announcedAt?.toISOString() ?? null,
      eligibleNow,
      announceAudience,
    };
  }

  private async history(winId?: string): Promise<AdminGiveawayDrawRow[]> {
    const draws = await this.prisma.giveawayDraw.findMany({
      where: winId ? { win: { id: winId } } : {},
      orderBy: [{ period: 'desc' }, { pool: 'asc' }],
      take: HISTORY_LIMIT,
      include: { win: { include: { user: { select: { email: true, name: true } } } } },
    });
    return draws.map((d) => ({
      drawId: d.id,
      period: d.period,
      pool: d.pool,
      drawnAt: d.drawnAt.toISOString(),
      eligibleCount: d.eligibleCount,
      eligibleHash: d.eligibleHash,
      drawnIndex: d.drawnIndex,
      win: d.win
        ? {
            id: d.win.id,
            userId: d.win.userId,
            email: d.win.user?.email ?? null,
            displayName: giveawayDisplayName(d.win.displayConsent, d.win.displayPseudo, d.win.user?.name ?? null),
            prizeMonths: d.win.prizeMonths,
            startsAt: d.win.startsAt.toISOString(),
            endsAt: d.win.endsAt.toISOString(),
            activationStatus: d.win.activationStatus,
            activationError: d.win.activationError,
            creditCents: d.win.creditCents,
            displayConsent: d.win.displayConsent,
            message: d.win.message,
            moderation: d.win.moderation,
            instagramConsent: d.win.instagramConsent,
            instagramHandle: d.win.instagramHandle,
            publicationStatus: d.win.publicationStatus,
            publishedUrl: d.win.publishedUrl,
            publishedAt: d.win.publishedAt?.toISOString() ?? null,
          }
        : null,
    }));
  }
}
